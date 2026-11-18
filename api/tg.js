// Ретранслятор Telegram для сервера в России: принимает сообщение и пересылает его боту.
// Живёт на Vercel (за рубежом), где api.telegram.org доступен.
// Переменные Vercel: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (один или несколько через запятую), TELEGRAM_RELAY_SECRET (тот же, что на сервере).
const crypto = require('crypto');

function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false }); }
  const secret = process.env.TELEGRAM_RELAY_SECRET;
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!secret || secret.length < 24 || !token || !chat) return res.status(404).json({ ok: false });
  if (!same(req.headers['x-relay-secret'] || '', secret)) return res.status(403).json({ ok: false });

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  const text = b && typeof b.text === 'string' ? b.text.slice(0, 4000) : '';
  if (!text) return res.status(400).json({ ok: false });

  // TELEGRAM_CHAT_ID может быть списком через запятую: каждый получатель получает сообщение.
  const chats = String(chat).split(/[,;\s]+/).filter(Boolean);
  const results = await Promise.all(chats.map(async function (id) {
    const body = { chat_id: id, text: text, disable_web_page_preview: true };
    if (b.html) body.parse_mode = 'HTML';
    try {
      const r = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) console.error('Telegram', id, r.status, await r.text());
      return r.ok;
    } catch (e) {
      console.error('Telegram', id, e && e.message);
      return false;
    }
  }));
  // Успех, если сообщение дошло хоть до одного получателя.
  const sent = results.filter(Boolean).length;
  if (!sent) return res.status(502).json({ ok: false });
  return res.status(200).json({ ok: true, sent: sent, total: chats.length });
};
