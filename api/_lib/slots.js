// Занятость времени для записи с сайта. Общая для /api/queue (что показать на сайте) и /api/lead (защита от двойной записи).
// Время делится на слоты по 30 минут, как в «Расписании» CRM. В один слот помещается CAPACITY машин:
// когда записей на это время столько же, слот на сайте становится недоступен, а заявку на него сервер не примет.
const CAPACITY = 3;                         // сколько машин одновременно на одно время (12:00 — до 3, 12:30 — до 3 …)
const SKIP = ['Отменён', 'Не приехал'];     // такие записи место не занимают

// «12:40» → «12:30»; не время — ''
function slotOf(time) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)/.exec(String(time || ''));
  return m ? m[1] + ':' + (Number(m[2]) < 30 ? '00' : '30') : '';
}
function counts(bookings) { // { 'ГГГГ-ММ-ДД': { '12:00': 2, … } }
  const out = {};
  bookings.forEach(function (b) {
    const s = slotOf(b.time);
    if (!b.date || !s || SKIP.indexOf(b.status) >= 0) return;
    (out[b.date] = out[b.date] || {})[s] = (out[b.date][s] || 0) + 1;
  });
  return out;
}
// занятые слоты по дням с from до to включительно: { 'ГГГГ-ММ-ДД': ['12:00', …] }; только время, без клиентов
function full(bookings, from, to) {
  const c = counts(bookings), out = {};
  Object.keys(c).forEach(function (d) {
    if (d < from || d > to) return;
    const f = Object.keys(c[d]).filter(function (s) { return c[d][s] >= CAPACITY; }).sort();
    if (f.length) out[d] = f;
  });
  return out;
}
function taken(bookings, date, time) { const s = slotOf(time), c = counts(bookings); return (c[date] && c[date][s]) || 0; }
// входит ли запись id в первые CAPACITY записей своего слота (по порядку номеров) — для проверки после сохранения
function fits(bookings, date, time, id) {
  const s = slotOf(time);
  const ids = bookings.filter(function (b) { return b.date === date && slotOf(b.time) === s && SKIP.indexOf(b.status) < 0; })
    .map(function (b) { return Number(b.id); }).sort(function (a, b) { return a - b; });
  return ids.indexOf(Number(id)) < CAPACITY;
}

module.exports = { CAPACITY: CAPACITY, slotOf: slotOf, full: full, taken: taken, fits: fits };
