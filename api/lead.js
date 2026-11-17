// Принимает заявку онлайн-записи с сайта и пересылает её в Telegram.
// Работает как серверная функция Vercel: адрес на сайте — /api/lead.
// Токен бота и чат задаются в настройках проекта Vercel (Settings → Environment Variables):
//   TELEGRAM_BOT_TOKEN — токен от @BotFather
//   TELEGRAM_CHAT_ID   — куда слать заявки (личка или группа мастеров)

// Если подключена база CRM, заявка ещё и попадает в раздел «Запись» со статусом «Новая».
const store = require('./_lib/store');
const slots = require('./_lib/slots'); // до slots.CAPACITY машин на одно время: на занятое время заявку не принимаем
const tg = require('./_lib/tg'); // Telegram напрямую или через ретранслятор
const log = require('./_lib/log'); // журнал действий: заявка с сайта попадает туда от имени «Сайт»

const hits = new Map(); // защита от спама: не больше 5 заявок с одного адреса за 10 минут
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 5;

function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  return list.length > MAX_HITS;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method' });
  }

  const tgOn = tg.configured();
  if (!tgOn && !store.available()) return res.status(500).json({ ok: false, error: 'not configured' });

  // На Vercel адрес клиента ставит Vercel, на своём сервере — nginx (TRUST_PROXY=1)
  const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (tooMany(ip)) return res.status(429).json({ ok: false, error: 'too many' });

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (!b || typeof b !== 'object') return res.status(400).json({ ok: false, error: 'body' });

  const lead = {
    service: clean(b.service, 40),
    car: clean(b.car, 30),
    radius: clean(b.radius, 20),
    price: clean(b.price, 30),
    day: clean(b.day, 40),
    time: clean(b.time, 20),
    name: clean(b.name, 60),
    phone: clean(b.phone, 20).replace(/\D/g, ''),
    comment: clean(b.comment, 500),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : ''
  };
  if (lead.name.length < 2 || lead.phone.length !== 11) return res.status(400).json({ ok: false, error: 'fields' });

  const p = lead.phone;
  const phone = '+' + p[0] + ' (' + p.slice(1, 4) + ') ' + p.slice(4, 7) + '-' + p.slice(7, 9) + '-' + p.slice(9, 11);

  // 1) в CRM (если база подключена). Ошибка базы не мешает отправке в Telegram.
  let savedToCrm = false;
  if (store.available()) {
    try {
      const notes = [
        [lead.car, lead.radius].filter(Boolean).join(', '),
        lead.price ? 'цена по калькулятору ' + lead.price : '',
        !lead.date && lead.day ? 'когда удобно: ' + lead.day : '',
        lead.comment
      ].filter(Boolean).join('. ');
      const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(lead.time) ? lead.time : '';
      // время занято (записей на него уже slots.CAPACITY) — клиент выберет другое
      if (lead.date && time && slots.taken(await store.list('bookings'), lead.date, time) >= slots.CAPACITY) {
        return res.status(409).json({ ok: false, error: 'full' });
      }
      const bk = await store.insert('bookings', {
        date: lead.date, time: time,
        plate: '', name: lead.name, phone: phone, service: lead.service, status: 'Новая',
        comment: notes.slice(0, 600), source: 'site', created: new Date().toISOString()
      });
      // две заявки на последнее место пришли одновременно: остаётся та, что сохранилась раньше
      if (lead.date && time && !slots.fits(await store.list('bookings'), lead.date, time, bk.id)) {
        await store.remove('bookings', bk.id);
        return res.status(409).json({ ok: false, error: 'full' });
      }
      savedToCrm = true;
      await log.change('Сайт', 'site', 'bookings', null, bk);
    } catch (e) {
      console.error('Заявка не сохранилась в CRM', e);
    }
  }
  const lines = [
    '🛞 <b>Новая заявка с сайта</b>',
    '',
    '<b>Услуга:</b> ' + esc(lead.service || 'не выбрана'),
    '<b>Машина:</b> ' + esc([lead.car, lead.radius].filter(Boolean).join(', ') || 'не указана'),
    lead.price ? '<b>Цена по калькулятору:</b> ' + esc(lead.price) : null,
    '<b>Когда:</b> ' + esc([lead.day, lead.time].filter(Boolean).join(', ') || 'не указано'),
    '',
    '<b>Имя:</b> ' + esc(lead.name),
    '<b>Телефон:</b> ' + phone,
    lead.comment ? '<b>Комментарий:</b> ' + esc(lead.comment) : null
  ].filter(l => l !== null);

  // 2) в Telegram. Если не дошло, но заявка уже в CRM — клиенту всё равно отвечаем «принято».
  if (!tgOn) return savedToCrm ? res.status(200).json({ ok: true }) : res.status(500).json({ ok: false, error: 'not configured' });
  const sent = await tg.send(lines.join('\n'), { html: true });
  if (!sent && !savedToCrm) return res.status(502).json({ ok: false, error: 'telegram' });
  return res.status(200).json({ ok: true });
};
