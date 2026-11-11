// Какие поля бывают у записей CRM и как их проверять. Всё, чего нет в схеме, отбрасывается.
const STATUS = ['Новая', 'Записан', 'Приехал', 'Не приехал', 'Отменён'];
const UNITS = ['4 колеса', '1 колесо', 'услуга'];
const PAY = ['Нал', 'Карта', 'Перевод'];
// у работ есть ещё «Безнал» — оплата компании по счёту (10.11.2026); тогда в работе номер компании (company)
const JPAY = PAY.concat(['Безнал']);
const VAT = ['Без НДС', 'НДС 5%', 'НДС 7%', 'НДС 22%'];
// покраска дисков: диаметр кнопками, статусы заказа
const RADII = ['R13', 'R14', 'R15', 'R16', 'R17', 'R18', 'R19', 'R20', 'R21', 'R22'];
const PSTATUS = ['Принято', 'В работе', 'Готово', 'Выдано'];

function S(max, req) { return { t: 'str', max: max, req: !!req }; }
function I(min, max, req) { return { t: 'int', min: min, max: max, req: !!req }; }
function E(opts, def) { return { t: 'enum', opts: opts, def: def }; }

const SCHEMA = {
  clients: { plate: { t: 'plate', req: true }, name: S(60), phone: S(30), make: S(40), model: S(40), size: S(30), note: S(300) },
  bookings: {
    date: { t: 'date' }, time: { t: 'time' }, car: S(60), plate: { t: 'plate' }, name: S(60), phone: S(30), service: S(120),
    status: E(STATUS, 'Записан'), comment: S(600), source: E(['crm', 'site'], 'crm')
  },
  jobs: {
    // items — несколько услуг в одной работе; service/qty/price/unit — первая услуга (старые работы — только они)
    date: { t: 'date', req: true }, plate: { t: 'plate' }, car: S(60), items: { t: 'items' }, service: S(400, true), qty: I(0, 99), price: I(0, 1000000),
    unit: E(UNITS, '1 колесо'), adjust: I(-1000000, 1000000), pay: E(JPAY, 'Нал'), company: I(0, 1000000000), master: S(60), comment: S(300),
    // kind: 'sale' — продажа б/у шин (в кассу идёт, процент мастеру не начисляется); tire — номер шины на складе
    kind: E(['work', 'sale'], 'work'), tire: I(0, 1000000000)
  },
  // склад б/у шин на продажу: qty — принято, sold — продано/выдано, остаток = qty − sold; price — цена продажи за 1 шину
  tires: {
    received: { t: 'date', req: true }, size: S(30, true), radius: I(0, 40), brand: S(80), season: E(['Зима', 'Лето', 'Всесезон'], 'Зима'),
    price: I(0, 1000000), qty: I(0, 999), sold: I(0, 999), note: S(300)
  },
  storage: {
    received: { t: 'date', req: true }, plate: { t: 'plate' }, name: S(60), phone: S(30), tires: S(120), size: S(30), qty: I(0, 99),
    rims: E(['С дисками', 'Без дисков'], 'Без дисков'), season: E(['Лето', 'Зима', 'Всесезон'], 'Зима'),
    until: { t: 'date' }, cost: I(0, 1000000), paid: { t: 'bool' }, issued: { t: 'date' }, note: S(300),
    // когда и как оплатили хранение — для кассы по дням
    paidOn: { t: 'date' }, payBy: E(PAY, 'Нал')
  },
  // покраска дисков (ведёт только владелец, касса отдельная — мастерам не идёт).
  // price — цена за весь заказ; prepaid — аванс (в кассу покраски в день prepaidOn); остаток price − prepaid — в день выдачи issued.
  // prepaidOn, readyOn, issued, photos ставит сервер. Фото лежат отдельно, в коллекции «_pp:<номер заказа>».
  paint: {
    received: { t: 'date', req: true }, phone: S(30, true), name: S(60), plate: { t: 'plate' }, car: S(60),
    radius: E(RADII, 'R16'), qty: I(0, 8), turn: { t: 'bool' }, color: S(60, true), cond: S(300), due: { t: 'date' },
    price: I(0, 1000000), prepaid: I(0, 1000000), prepaidBy: E(PAY, 'Нал'), prepaidOn: { t: 'date' },
    status: E(PSTATUS, 'Принято'), readyOn: { t: 'date' }, issued: { t: 'date' }, pay: E(PAY, 'Нал'), note: S(300), photos: I(0, 99)
  },
  prices: { name: S(120, true), price: I(0, 1000000), unit: E(UNITS, '1 колесо'), note: S(200) },
  settings: { masterPct: I(0, 100) },
  // безнал (10.11.2026): компании-плательщики заводит владелец; shop — реквизиты самой мастерской для счёта (одна запись);
  // invoices — выставленные счета: jobs — номера работ через запятую, sum и paidOn ставит сервер
  companies: {
    name: S(160, true), inn: S(12), kpp: S(9), ogrn: S(15), address: S(300), bank: S(160), bik: S(9), account: S(20), corr: S(20),
    contact: S(120), phone: S(30), email: S(80), note: S(300)
  },
  shop: {
    name: S(160), inn: S(12), kpp: S(9), ogrn: S(15), address: S(300), bank: S(160), bik: S(9), account: S(20), corr: S(20),
    phone: S(60), head: S(120), vat: E(VAT, 'Без НДС'), footer: S(300),
    // из карточки предприятия (11.11.2026)
    fullName: S(250), factAddress: S(300), postAddress: S(300), okpo: S(14), okato: S(11), oktmo: S(11),
    bankInn: S(10), bankKpp: S(9), email: S(80), headFull: S(160)
  },
  invoices: { date: { t: 'date', req: true }, company: I(1, 1000000000, true), jobs: S(4000, true), note: S(300), paid: { t: 'bool' }, paidOn: { t: 'date' } },
  // очередь для сайта (одна запись): wait — минут ожидания, 0 — свободно, -1 — сегодня только по записи; at/by ставит сервер
  queue: { wait: I(-1, 600) },
  // сотрудники: входят по коду из 4 цифр с правами мастера; код хранится как подпись (pinHash), его ставит api/crm.js
  // access: «Мастер» — права мастера; «Только запись» — видит только запись и расписание и записывает машины (07.11.2026)
  staff: { name: S(60, true), access: E(['Мастер', 'Только запись'], 'Мастер') },
  // одна услуга внутри работы (не коллекция, только для проверки items)
  _item: { service: S(120, true), qty: I(0, 99), price: I(0, 1000000), unit: E(UNITS, '1 колесо') }
};

// Госномер: заглавные, без пробелов, латинские «двойники» → кириллица (А123ВС82)
const LAT = 'ABEKMHOPCTYX', CYR = 'АВЕКМНОРСТУХ';
function plate(v) {
  return String(v || '').toUpperCase().replace(/[\s\-]/g, '')
    .replace(/[ABEKMHOPCTYX]/g, function (ch) { return CYR[LAT.indexOf(ch)]; }).slice(0, 12);
}

// Возвращает { data } или { error: 'имя поля' }
function clean(coll, input) {
  const sch = SCHEMA[coll], out = {};
  for (const k of Object.keys(sch)) {
    const f = sch[k];
    let v = input[k];
    const empty = v === undefined || v === null || v === '';
    if (f.t === 'bool') { out[k] = v === true || v === 'true' || v === 1; continue; }
    if (f.t === 'items') {
      if (empty) { out[k] = []; continue; }
      if (!Array.isArray(v) || v.length > 20) return { error: k };
      const list = [];
      for (const it of v) {
        const c = clean('_item', it && typeof it === 'object' ? it : {});
        if (c.error) return { error: k };
        list.push(c.data);
      }
      out[k] = list;
      continue;
    }
    if (f.t === 'enum') { out[k] = f.opts.indexOf(v) >= 0 ? v : f.def; continue; }
    if (empty) { if (f.req) return { error: k }; out[k] = f.t === 'int' ? 0 : ''; continue; }
    if (f.t === 'str') {
      v = String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, f.max);
      if (!v && f.req) return { error: k };
      out[k] = v;
    } else if (f.t === 'int') {
      const n = Math.round(Number(v));
      if (!isFinite(n) || n < f.min || n > f.max) return { error: k };
      out[k] = n;
    } else if (f.t === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) return { error: k };
      out[k] = v;
    } else if (f.t === 'time') {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return { error: k };
      out[k] = v;
    } else if (f.t === 'plate') {
      out[k] = plate(v);
      if (!out[k] && f.req) return { error: k };
    }
  }
  return { data: out };
}

// Сумма услуги, как в Excel: «4 колеса» — цена за комплект, делится по колёсам; иначе цена × количество
function lineSum(l) {
  const qty = l.qty || (l.unit === '4 колеса' ? 4 : 1);
  return Math.round(l.unit === '4 колеса' ? l.price / 4 * qty : l.price * qty);
}
// Сумма работы: все услуги (или одна — у старых работ) плюс скидка/доплата
function jobSum(j) {
  const lines = j.items && j.items.length ? j.items : [j];
  return lines.reduce(function (a, l) { return a + lineSum(l); }, 0) + (j.adjust || 0);
}

module.exports = { SCHEMA: SCHEMA, STATUS: STATUS, PSTATUS: PSTATUS, UNITS: UNITS, PAY: PAY, JPAY: JPAY, VAT: VAT, clean: clean, plate: plate, jobSum: jobSum };
