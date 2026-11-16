// Очередь на сегодня для сайта: сколько ждать и какое время уже занято записями.
// Адрес — /api/queue (GET). Данные берутся из CRM: мастер ставит очередь кнопками в разделе «Сегодня».
// Личные данные наружу не отдаются: только минуты ожидания и занятые слоты (время, без клиентов).
// full — занятые слоты по дням на 8 дней вперёд (в слоте 30 минут помещается slots.CAPACITY машин), busy — занятые сегодня.
// Без базы (сейчас на Vercel) отвечает { ok: false }, и сайт показывает ближайшее время для записи.
const store = require('./_lib/store');
const slots = require('./_lib/slots');

const FRESH_MS = 3 * 3600e3;  // очередь старше 3 часов на сайте не показываем

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=15, s-maxage=15');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ ok: false }); }
  if (!store.available()) return res.status(200).json({ ok: false, error: 'no-db' });
  try {
    const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); // Крым, UTC+3
    const q = (await store.list('queue'))[0];
    const fresh = q && q.at && Date.now() - Date.parse(q.at) < FRESH_MS &&
      new Date(Date.parse(q.at) + 3 * 3600e3).toISOString().slice(0, 10) === today;
    const last = new Date(Date.now() + 3 * 3600e3 + 8 * 86400e3).toISOString().slice(0, 10);
    const full = slots.full(await store.list('bookings'), today, last);
    return res.status(200).json({ ok: true, wait: fresh && Number.isInteger(q.wait) ? q.wait : null, at: fresh ? q.at : null,
      cap: slots.CAPACITY, full: full, busy: full[today] || [] });
  } catch (e) {
    console.error('Очередь не прочиталась', e);
    return res.status(200).json({ ok: false, error: 'server' });
  }
};
