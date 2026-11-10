// Очередь на сегодня для сайта: сколько ждать и какие часы уже заняты записями.
// Адрес — /api/queue (GET). Данные берутся из CRM: мастер ставит очередь кнопками в разделе «Сегодня».
// Личные данные наружу не отдаются: только минуты ожидания и занятые часы.
// Без базы (сейчас на Vercel) отвечает { ok: false }, и сайт показывает ближайшее время для записи.
const store = require('./_lib/store');

const POSTS = 2;              // сколько машин берём в работу за час; час с таким числом записей считается занятым
const FRESH_MS = 3 * 3600e3;  // очередь старше 3 часов на сайте не показываем

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ ok: false }); }
  if (!store.available()) return res.status(200).json({ ok: false, error: 'no-db' });
  try {
    const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); // Крым, UTC+3
    const q = (await store.list('queue'))[0];
    const fresh = q && q.at && Date.now() - Date.parse(q.at) < FRESH_MS &&
      new Date(Date.parse(q.at) + 3 * 3600e3).toISOString().slice(0, 10) === today;
    const perHour = {};
    (await store.list('bookings')).forEach(function (b) {
      if (b.date !== today || !b.time || ['Отменён', 'Не приехал'].indexOf(b.status) >= 0) return;
      const h = b.time.slice(0, 2) + ':00';
      perHour[h] = (perHour[h] || 0) + 1;
    });
    const busy = Object.keys(perHour).filter(function (h) { return perHour[h] >= POSTS; }).sort();
    return res.status(200).json({ ok: true, wait: fresh && Number.isInteger(q.wait) ? q.wait : null, at: fresh ? q.at : null, busy: busy });
  } catch (e) {
    console.error('Очередь не прочиталась', e);
    return res.status(200).json({ ok: false, error: 'server' });
  }
};
