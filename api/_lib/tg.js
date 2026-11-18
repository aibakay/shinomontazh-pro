// Отправка сообщения в Telegram (заявки с сайта, тревоги CRM).
// Два способа:
//  • напрямую: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (так работает Vercel; чатов может быть несколько через запятую);
//  • через ретранслятор: TELEGRAM_RELAY_URL + TELEGRAM_RELAY_SECRET — для сервера в России,
//    откуда api.telegram.org открывается ненадёжно. Ретранслятор — функция api/tg.js на Vercel,
//    она сама знает токен бота и чат. Сам токен на российском сервере тогда не нужен.
function configured() {
  return !!((process.env.TELEGRAM_RELAY_URL && process.env.TELEGRAM_RELAY_SECRET) ||
    (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID));
}

// Возвращает true, если Telegram принял сообщение.
async function send(text, opts) {
  opts = opts || {};
  const html = !!opts.html;
  const timeout = opts.timeout || 8000;
  const relay = process.env.TELEGRAM_RELAY_URL, secret = process.env.TELEGRAM_RELAY_SECRET;
  try {
    let r;
    if (relay && secret) {
      r = await fetch(relay, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Relay-Secret': secret },
        body: JSON.stringify({ text: text, html: html }),
        signal: AbortSignal.timeout(timeout)
      });
    } else {
      const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
      if (!token || !chat) return false;
      // Несколько получателей — через запятую; успех, если дошло хоть до одного.
      // TELEGRAM_CHAT_IDS_EXTRA — дополнительные получатели (через запятую), чтобы не трогать основной ID.
      const chats = Array.from(new Set((String(chat) + ',' + (process.env.TELEGRAM_CHAT_IDS_EXTRA || ''))
        .split(/[,;\s]+/).filter(Boolean)));
      const rs = await Promise.all(chats.map(function (id) {
        const body = { chat_id: id, text: text, disable_web_page_preview: true };
        if (html) body.parse_mode = 'HTML';
        return fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body), signal: AbortSignal.timeout(timeout)
        }).catch(function (e) { console.error('Telegram', id, e && e.message); return null; });
      }));
      r = rs.find(function (x) { return x && x.ok; }) || rs.find(Boolean);
      if (!r) return false;
    }
    if (!r.ok) console.error('Telegram ответил ошибкой', r.status, await r.text().catch(() => ''));
    return r.ok;
  } catch (e) {
    console.error('Не удалось связаться с Telegram', e && e.message);
    return false;
  }
}

module.exports = { configured, send };
