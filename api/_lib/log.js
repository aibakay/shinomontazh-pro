// Журнал действий CRM (10.11.2026): кто и когда вошёл, что добавил, изменил или удалил. Видит только владелец.
// Записи лежат по дням в коллекциях «_log:ГГГГ-ММ-ДД» и хранятся 90 дней, старые удаляются сами.
// Ошибка журнала никогда не мешает самому действию.
const store = require('./store');

const KEEP_DAYS = 90, MAX_ROWS = 3000;
function day(shift) { return new Date(Date.now() + 3 * 3600e3 - (shift || 0) * 864e5).toISOString().slice(0, 10); } // Крым, UTC+3

// [название, добавлено, изменено, удалено]
const NAMES = {
  jobs: ['Работа', 'добавлена', 'изменена', 'удалена'], bookings: ['Запись', 'добавлена', 'изменена', 'удалена'],
  clients: ['Клиент', 'добавлен', 'изменён', 'удалён'], storage: ['Хранение', 'принято', 'изменено', 'удалено'],
  tires: ['Б/у шины', 'добавлены', 'изменены', 'удалены'], paint: ['Покраска', 'принята', 'изменена', 'удалена'],
  prices: ['Услуга в прайсе', 'добавлена', 'изменена', 'удалена'], staff: ['Сотрудник', 'добавлен', 'изменён', 'удалён'],
  settings: ['Настройки', 'заданы', 'изменены', 'удалены'], queue: ['Очередь на сайте', 'задана', 'изменена', 'удалена']
};
// поля, которые показываем в «что изменилось»: [поле, подпись, вид]
const FIELDS = {
  clients: [['plate', 'Госномер'], ['name', 'Имя'], ['phone', 'Телефон'], ['make', 'Марка'], ['model', 'Модель'], ['size', 'Размер'], ['note', 'Заметка']],
  bookings: [['date', 'Дата', 'date'], ['time', 'Время'], ['plate', 'Госномер'], ['car', 'Марка авто'], ['name', 'Имя'], ['phone', 'Телефон'], ['service', 'Услуга'], ['status', 'Статус'], ['comment', 'Комментарий']],
  jobs: [['date', 'Дата', 'date'], ['plate', 'Госномер'], ['car', 'Машина'], ['items', 'Услуги', 'lines'], ['adjust', 'Скидка/доплата', 'money'], ['sum', 'Сумма', 'money'], ['pay', 'Оплата'], ['master', 'Мастер'], ['comment', 'Комментарий']],
  tires: [['received', 'Дата приёма', 'date'], ['size', 'Размер'], ['brand', 'Марка'], ['season', 'Сезон'], ['price', 'Цена', 'money'], ['qty', 'Принято, шт.'], ['sold', 'Продано, шт.'], ['note', 'Заметка']],
  storage: [['received', 'Дата приёма', 'date'], ['plate', 'Госномер'], ['name', 'Имя'], ['phone', 'Телефон'], ['tires', 'Шины'], ['size', 'Размер'], ['qty', 'Количество'], ['rims', 'Диски'], ['season', 'Сезон'],
    ['until', 'Хранить до', 'date'], ['cost', 'Стоимость', 'money'], ['paid', 'Оплачено', 'bool'], ['payBy', 'Способ оплаты'], ['issued', 'Выдано', 'date'], ['note', 'Заметка']],
  paint: [['received', 'Дата приёма', 'date'], ['phone', 'Телефон'], ['name', 'Имя'], ['plate', 'Госномер'], ['car', 'Машина'], ['radius', 'Диаметр'], ['qty', 'Количество'], ['turn', 'Проточка', 'bool'], ['color', 'Цвет'],
    ['cond', 'Состояние'], ['due', 'Срок', 'date'], ['price', 'Цена', 'money'], ['prepaid', 'Аванс', 'money'], ['prepaidBy', 'Аванс оплачен'], ['status', 'Статус'], ['pay', 'Оплата'], ['note', 'Заметка']],
  prices: [['name', 'Название'], ['price', 'Цена', 'money'], ['unit', 'Указана за'], ['note', 'Примечание']],
  settings: [['masterPct', 'Процент мастера']],
  staff: [['name', 'Имя'], ['access', 'Доступ'], ['pinHash', 'Код', 'secret']],
  queue: [['wait', 'Ожидание', 'wait']]
};

function money(n) { return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }
function dmy(iso) { return iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : ''; }
function lines(j) {
  const ls = j.items && j.items.length ? j.items : j.service ? [j] : [];
  return ls.map(function (l) { return (l.service || '') + (l.qty ? ' ×' + l.qty : '') + ' по ' + money(l.price); }).join('; ');
}
function wait(n) { return n < 0 ? 'только по записи' : n ? n + ' мин' : 'свободно'; }
function show(doc, f) {
  const v = doc[f[0]], t = f[2];
  if (t === 'lines') return lines(doc);
  if (t === 'bool') return v ? 'да' : 'нет';
  if (t === 'wait') return wait(Number(v) || 0);
  if (t === 'money') return v ? money(v) : '';
  if (t === 'date') return dmy(v || '');
  if (f[0] === 'access') return v || 'Мастер';
  return v === undefined || v === null ? '' : String(v);
}
function cut(s) { s = String(s); return s.length > 160 ? s.slice(0, 157) + '…' : s; }

// что изменилось: ['Цена: 1 500 ₽ → 1 200 ₽', ...]
function diff(coll, old, doc) {
  const out = [];
  for (const f of FIELDS[coll] || []) {
    if (f[2] === 'secret') { if ((old[f[0]] || '') !== (doc[f[0]] || '')) out.push(f[1] + ': задан новый'); continue; }
    const a = show(old, f), b = show(doc, f);
    if (a !== b) out.push(f[1] + ': ' + cut(a || '—') + ' → ' + cut(b || '—'));
  }
  return out;
}
// о какой записи речь, одной строкой
function describe(coll, d) {
  let p = [];
  if (coll === 'jobs') p = [dmy(d.date), d.plate, d.service, money(d.sum)];
  else if (coll === 'bookings') p = [dmy(d.date) + (d.time ? ' ' + d.time : ''), d.plate, d.name, d.service];
  else if (coll === 'clients') p = [d.plate, d.name, d.phone];
  else if (coll === 'storage') p = ['бирка № ' + d.id, d.plate, d.name, d.tires];
  else if (coll === 'tires') p = [d.size, d.brand, (d.qty || 0) + ' шт.'];
  else if (coll === 'paint') p = ['№ П-' + d.id, d.name, d.phone, d.color, d.radius];
  else if (coll === 'prices') p = [d.name, d.price ? money(d.price) : 'договорная'];
  else if (coll === 'staff') p = [d.name, d.access || 'Мастер'];
  else if (coll === 'settings') p = ['Процент мастера: ' + d.masterPct + '%'];
  else if (coll === 'queue') p = [wait(Number(d.wait) || 0)];
  return cut(p.filter(Boolean).join(' · '));
}

let purged = '';
// e: { who, role, kind: 'in' | 'out' | 'fail' | 'add' | 'edit' | 'del', title, text?, ch?, coll?, rid?, ip? }
async function add(e) {
  try {
    const d = day();
    await store.insert('_log:' + d, Object.assign({ at: new Date().toISOString() }, e));
    if (purged !== d) { purged = d; await store.removeBelow('_log:', '_log:' + day(KEEP_DAYS)); }
  } catch (err) { console.error('CRM: журнал не записан', err); }
}
// запись о добавлении / изменении / удалении документа; изменение без отличий не пишем
function change(who, role, coll, old, doc) {
  const n = NAMES[coll]; if (!n) return Promise.resolve();
  const e = { who: who, role: role, coll: coll, rid: (doc || old).id };
  if (!doc) Object.assign(e, { kind: 'del', title: n[0] + ' ' + n[3], text: describe(coll, old) });
  else if (!old) Object.assign(e, { kind: 'add', title: n[0] + ' ' + n[1], text: describe(coll, doc) });
  else {
    const ch = diff(coll, old, doc);
    if (!ch.length) return Promise.resolve();
    Object.assign(e, { kind: 'edit', title: n[0] + ' ' + n[2], text: describe(coll, doc), ch: ch.slice(0, 30) });
  }
  return add(e);
}
// журнал за дни from…to (ГГГГ-ММ-ДД), новые сверху
async function read(from, to) {
  const rows = await store.listRange('_log:' + from, '_log:' + to);
  rows.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id; });
  return { list: rows.slice(0, MAX_ROWS), more: rows.length > MAX_ROWS };
}

module.exports = { add: add, change: change, read: read, describe: describe, day: day, KEEP_DAYS: KEEP_DAYS };
