// API внутренней CRM (страница /crm/). Один адрес, действие — в поле action.
//   login {password} · logout · load · save {coll, id?, data} · remove {coll, id}
// Права: владелец — всё; мастер — без настроек (процент мастера), без правки прайса, сотрудников и без удаления.
// Мастер записывает и правит работы только за сегодня; хранение и б/у шины ему не видны (их ведёт владелец).
// Сотрудники (staff) входят по своему коду из 4 цифр с правами мастера.
// Покраску дисков (paint) и её фото видит и ведёт только владелец; её деньги — отдельная касса, мастерам не идут.
const store = require('./_lib/store');
const auth = require('./_lib/auth');
const schema = require('./_lib/schema');
const log = require('./_lib/log'); // журнал действий: кто что сделал (видит только владелец)
const plates = require('./_lib/plates'); // проверка госномеров: что не номер — в марку, имя или телефон
const { PRICES } = require('./_lib/seed');

const COLLS = Object.keys(schema.SCHEMA).filter(function (c) { return c[0] !== '_'; });
// хранение и б/у шины ведёт отдельный человек (владелец), мастеру они не видны
const MASTER_WRITE = ['clients', 'bookings', 'jobs', 'expenses']; // очередь на сайте ставит только владелец (30.10.2026)
const OWNER_ONLY = ['settings', 'staff', 'storage', 'tires', 'paint', 'shop', 'invoices']; // покраску дисков принимает только владелец
// компании для безнала заводит владелец; мастер видит только их названия — чтобы выбрать компанию в работе
// сотрудник «Только запись» (роль booker): видит запись и расписание, записывает машины; работ, кассы и прочего не видит
const BOOKER_READ = ['bookings', 'clients', 'prices'];
const BOOKER_WRITE = ['bookings', 'clients'];
// цена «от» в прайсе: такую мастер может вписать сам (примечание вроде «цена «от»»)
function priceFrom(p) { return /(^|[^а-яё])от([^а-яё]|$)/i.test(String(p.note || '')); }
function today() { return new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); } // Крым, UTC+3

// Неудачные входы храним в базе (на Vercel память у каждого запуска своя):
//  • с одного адреса — не больше 8 ошибок за 15 минут;
//  • коды из 4 цифр — не больше 20 ошибок в час со всех адресов вместе, потом вход по коду закрыт до конца часа
//    (так перебор 10 000 кодов займёт сотни часов). Владелец по длинному паролю входит и в это время.
//  • коды — не больше 40 ошибок за сутки со всех адресов: у владельца тоже есть код (CRM_OWNER_PIN),
//    поэтому подбор растягиваем до месяцев. О закрытии входа по коду приходит сообщение в Telegram.
const IP_MAX = 8, IP_WIN = 15 * 60e3, PIN_MAX = 20, PIN_WIN = 60 * 60e3, PIN_DAY_MAX = 40, DAY = 24 * 3600e3;
async function failsDoc() {
  const d = (await store.list('_fails'))[0];
  return d || await store.insert('_fails', { list: [] });
}
async function blocked(ip, isPin) {
  const d = await failsDoc(), now = Date.now();
  const list = (d.list || []).filter(function (x) { return now - x.t < DAY; });
  if (list.filter(function (x) { return x.ip === ip && now - x.t < IP_WIN; }).length >= IP_MAX) return 'too-many';
  if (isPin && pinLocked(list, now)) return 'pin-locked';
  return null;
}
function pinLocked(list, now) {
  const pins = list.filter(function (x) { return x.pin; });
  return pins.filter(function (x) { return now - x.t < PIN_WIN; }).length >= PIN_MAX || pins.length >= PIN_DAY_MAX;
}
async function fail(ip, isPin) {
  const d = await failsDoc(), now = Date.now();
  const list = (d.list || []).filter(function (x) { return now - x.t < DAY; }).slice(-500);
  const was = pinLocked(list, now);
  list.push({ ip: ip, t: now, pin: !!isPin });
  await store.update('_fails', d.id, { list: list });
  if (isPin && !was && pinLocked(list, now)) await alert('CRM: вход по коду закрыт — много неверных кодов подряд. Если это были не вы, смените коды (CRM_OWNER_PIN и коды сотрудников).');
}
// Короткое сообщение владельцу в тот же Telegram, куда идут заявки. Ошибки не мешают входу.
async function alert(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat || typeof fetch !== 'function') return;
  try {
    await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: text }), signal: AbortSignal.timeout(4000)
    });
  } catch (e) { /* не дошло — не страшно */ }
}
// Адрес клиента. На Vercel заголовок x-forwarded-for ставит сам Vercel (подделку он затирает);
// на своём сервере заголовку не верим — берём адрес соединения.
function clientIp(req) {
  if (process.env.VERCEL) return String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

let seeded = false;
async function ensureSeed() {
  if (seeded) return;
  const settings = await store.list('settings');
  if (!settings.length) {
    await store.insert('settings', { masterPct: 50 });
    for (const p of PRICES) await store.insert('prices', { name: p[0], price: p[1], unit: p[2], note: p[3] });
  }
  seeded = true;
}

function send(res, code, body) { return res.status(code).json(body); }

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { ok: false, error: 'method' }); }
  if (!/application\/json/.test(String(req.headers['content-type'] || ''))) return send(res, 415, { ok: false, error: 'type' });
  if (!auth.configured()) return send(res, 503, { ok: false, error: 'auth-not-configured' });
  if (!store.available()) return send(res, 503, { ok: false, error: 'db-not-configured' });

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (!b || typeof b !== 'object') return send(res, 400, { ok: false, error: 'body' });
  const ip = clientIp(req);

  if (b.action === 'login') {
    const pw = String(b.password || '').slice(0, 200);
    const isPin = /^\d{4}$/.test(pw);
    if (await blocked(ip, false)) return send(res, 429, { ok: false, error: 'too-many' });
    let role = auth.roleFor(pw), sid = null, pv = '', logName = '';
    if (!role && isPin) {
      if (await blocked(ip, true)) return send(res, 429, { ok: false, error: 'pin-locked' });
      if (auth.isOwnerPin(pw)) role = 'owner';
      else {
        const h = auth.pinHash(pw);
        const st = (await store.list('staff')).find(function (x) { return x.pinHash === h; });
        if (st) { role = st.access === 'Только запись' ? 'booker' : 'master'; sid = st.id; pv = auth.pinMark(st.pinHash); logName = st.name; }
      }
    }
    if (!role) {
      await fail(ip, isPin);
      await log.add({ who: '', role: '', kind: 'fail', title: isPin ? 'Неверный код' : 'Неверный пароль', ip: ip });
      return send(res, 401, { ok: false, error: 'password' });
    }
    await log.add({ who: logName || (role === 'owner' ? 'Владелец' : 'Мастер'), role: role, kind: 'in', title: 'Вход в CRM', text: isPin ? 'по коду' : 'по паролю', ip: ip });
    res.setHeader('Set-Cookie', auth.cookie(req, auth.token(role, sid, pv), auth.TTL));
    return send(res, 200, { ok: true, role: role });
  }
  if (b.action === 'logout') {
    const s0 = auth.sessionOf(req);
    if (s0) {
      let n0 = s0.role === 'owner' ? 'Владелец' : 'Мастер';
      try { if (s0.sid) { const st0 = (await store.list('staff')).find(function (x) { return x.id === s0.sid; }); if (st0) n0 = st0.name; } } catch (e) { /* имя не узнали — не страшно */ }
      await log.add({ who: n0, role: s0.role, kind: 'out', title: 'Выход из CRM', ip: ip });
    }
    res.setHeader('Set-Cookie', auth.cookie(req, '', 0));
    return send(res, 200, { ok: true });
  }

  const sess = auth.sessionOf(req);
  if (!sess) return send(res, 401, { ok: false, error: 'login' });
  const role = sess.role;

  try {
    // сотрудник вошёл по коду: если его удалили, сменили ему код или права — выходит из CRM
    let me = role === 'owner' ? 'Владелец' : 'Мастер';
    if (sess.sid) {
      const st = (await store.list('staff')).find(function (x) { return x.id === sess.sid; });
      const want = st && st.access === 'Только запись' ? 'booker' : 'master';
      if (!st || auth.pinMark(st.pinHash) !== sess.pv || want !== role) { res.setHeader('Set-Cookie', auth.cookie(req, '', 0)); return send(res, 401, { ok: false, error: 'login' }); }
      me = st.name;
    } else if (role === 'booker') return send(res, 401, { ok: false, error: 'login' });

    await ensureSeed();

    if (b.action === 'load') {
      const data = {};
      for (const c of COLLS) {
        if (role === 'booker' && BOOKER_READ.indexOf(c) < 0) { if (c !== 'settings' && c !== 'staff' && c !== 'queue') data[c] = []; continue; }
        if (role !== 'owner' && OWNER_ONLY.indexOf(c) >= 0) { if (c === 'storage' || c === 'tires' || c === 'paint' || c === 'invoices') data[c] = []; continue; }
        data[c] = await store.list(c);
      }
      if (role !== 'owner' && data.companies) data.companies = data.companies.map(function (x) { return { id: x.id, name: x.name }; });
      // неразобранные заявки с сайта видит только владелец; мастер видит их, когда владелец поставит «Записан»
      if (role !== 'owner' && data.bookings) data.bookings = data.bookings.filter(function (x) { return !(x.source === 'site' && x.status === 'Новая'); });
      // коды сотрудников наружу не отдаём
      if (data.staff) data.staff = data.staff.map(function (x) { return { id: x.id, name: x.name, access: x.access || 'Мастер' }; });
      return send(res, 200, { ok: true, role: role, me: me, staff: !!sess.sid, data: data });
    }

    // журнал действий: только владелец, не больше 92 дней за раз
    if (b.action === 'log') {
      if (role !== 'owner') return send(res, 403, { ok: false, error: 'forbidden' });
      const re = /^\d{4}-\d{2}-\d{2}$/, from = String(b.from || ''), to = String(b.to || '');
      if (!re.test(from) || !re.test(to) || isNaN(Date.parse(from)) || isNaN(Date.parse(to)) || from > to || Date.parse(to) - Date.parse(from) > 92 * 864e5) return send(res, 400, { ok: false, error: 'body' });
      const lg = await log.read(from, to);
      return send(res, 200, { ok: true, list: lg.list, more: lg.more, keep: log.KEEP_DAYS, sections: log.SECTIONS });
    }

    // Разовый перенос базы с ПК (файл .data/crm.json): только владелец и только пока в облаке нет своих записей
    if (b.action === 'import') {
      if (role !== 'owner') return send(res, 403, { ok: false, error: 'forbidden' });
      const db = b.db;
      if (!db || typeof db.docs !== 'object' || typeof db.seq !== 'object') return send(res, 400, { ok: false, error: 'body' });
      for (const c of ['jobs', 'clients', 'bookings']) if ((await store.list(c)).length) return send(res, 409, { ok: false, error: 'not-empty' });
      const done = {};
      for (const c of COLLS) {
        const docs = Object.values(db.docs[c] || {}).filter(function (d) { return d && Number.isInteger(d.id) && d.id > 0; });
        if (!docs.length) continue;
        const seq = Math.max(Number(db.seq[c]) || 0, ...docs.map(function (d) { return d.id; }));
        await store.replaceAll(c, docs, seq);
        done[c] = docs.length;
      }
      await log.add({ who: me, role: role, kind: 'add', title: 'Перенос базы с ПК', text: Object.keys(done).map(function (c) { return c + ': ' + done[c]; }).join(', ') });
      return send(res, 200, { ok: true, imported: done });
    }

    // Заменить весь прайс прайсом из seed.js (печатный прайс-лист). Старые работы не меняются — у них свои цены.
    if (b.action === 'reset-prices') {
      if (role !== 'owner') return send(res, 403, { ok: false, error: 'forbidden' });
      const docs = PRICES.map(function (p, i) { return { id: i + 1, name: p[0], price: p[1], unit: p[2], note: p[3] }; });
      await store.replaceAll('prices', docs, docs.length);
      await log.add({ who: me, role: role, kind: 'edit', title: 'Прайс заменён печатным', text: docs.length + ' услуг' });
      return send(res, 200, { ok: true, prices: docs.length });
    }

    // Проверка госномеров (только владелец). Без apply — список: что в поле «Госномер» не похоже на номер и куда его лучше перенести.
    // С apply [{coll, id, plate, to, text}] — переносит отмеченное: госномер очищается, значение уходит в марку/имя/телефон/комментарий.
    // Каждая правка — в журнал (было → стало), прежние записи целиком — в «_plates_backup». Если запись уже поменяли — пропускаем.
    if (b.action === 'plates') {
      if (role !== 'owner') return send(res, 403, { ok: false, error: 'forbidden' });
      const all = {};
      for (const c of plates.COLLS) all[c] = await store.list(c);
      const clientOf = {}; all.clients.forEach(function (c) { if (c.plate) clientOf[c.plate] = c; });
      if (!Array.isArray(b.apply)) {
        const list = [];
        for (const c of plates.COLLS) for (const d of all[c]) {
          const r = plates.classify(d.plate);
          if (r.kind === 'ok') continue;
          list.push({ coll: c, id: d.id, plate: d.plate, kind: r.kind, to: r.to, text: r.text, date: d.date || d.received || '', what: log.describe(c, d),
            client: c !== 'clients' && !!clientOf[d.plate] });
        }
        const opts = {}; plates.COLLS.forEach(function (c) { opts[c] = plates.options(c); });
        return send(res, 200, { ok: true, list: list, opts: opts });
      }
      if (b.apply.length > 3000) return send(res, 400, { ok: false, error: 'body' });
      const done = [], skipped = [], backup = [];
      for (const a of b.apply) {
        const c = a && String(a.coll), id = a && Number(a.id), to = a && String(a.to);
        if (plates.COLLS.indexOf(c) < 0 || !Number.isInteger(id) || to === 'keep' || !plates.options(c).some(function (o) { return o[0] === to; })) { skipped.push(a); continue; }
        const old = all[c].find(function (x) { return x.id === id; });
        if (!old || !old.plate || old.plate !== String(a.plate || '')) { skipped.push(a); continue; }
        const max = {}; Object.keys(schema.SCHEMA[c]).forEach(function (k) { max[k] = schema.SCHEMA[c][k].max; });
        const doc = await store.update(c, id, plates.apply(c, old, to, String(a.text || '').slice(0, 200), max, c === 'clients' ? null : clientOf[old.plate]));
        if (!doc) { skipped.push(a); continue; }
        backup.push({ coll: c, doc: old });
        await log.change(me, role, c, old, doc);
        done.push({ coll: c, id: id });
      }
      if (backup.length) await store.insert('_plates_backup', { at: new Date().toISOString(), who: me, list: backup });
      await log.add({ who: me, role: role, kind: 'edit', title: 'Проверка госномеров', text: 'Перенесено из поля «Госномер»: ' + done.length + (skipped.length ? ', пропущено: ' + skipped.length : '') });
      return send(res, 200, { ok: true, done: done.length, skipped: skipped.length });
    }

    // продажа б/у шин со склада: уменьшает остаток и проводит продажу в кассу работой kind='sale'
    if (b.action === 'sell') {
      if (role !== 'owner') return send(res, 403, { ok: false, error: 'forbidden' });
      const tid = Number(b.id), qty = Math.round(Number(b.qty)), price = Math.round(Number(b.price));
      const tire = (await store.list('tires')).find(function (x) { return x.id === tid; });
      if (!tire) return send(res, 404, { ok: false, error: 'not-found' });
      const left = (tire.qty || 0) - (tire.sold || 0);
      if (!Number.isInteger(qty) || qty < 1 || qty > left) return send(res, 400, { ok: false, error: 'field', field: 'sellQty' });
      if (!Number.isInteger(price) || price < 0 || price > 1000000) return send(res, 400, { ok: false, error: 'field', field: 'price' });
      const name = ('Продажа б/у шин: ' + [tire.size, tire.brand].filter(Boolean).join(' ')).slice(0, 120);
      const c = schema.clean('jobs', {
        date: role === 'owner' && b.date ? b.date : today(), plate: b.plate, items: [{ service: name, qty: qty, price: price, unit: '1 колесо' }],
        service: name, qty: qty, price: price, unit: '1 колесо', pay: b.pay, master: b.master, comment: b.comment, kind: 'sale', tire: tid
      });
      if (c.error) return send(res, 400, { ok: false, error: 'field', field: c.error });
      c.data.sum = schema.jobSum(c.data);
      Object.assign(c.data, { pct: 0, by: me, created: new Date().toISOString() });
      const t2 = await store.update('tires', tid, Object.assign({}, tire, { sold: (tire.sold || 0) + qty }));
      let job;
      try { job = await store.insert('jobs', c.data); }
      catch (e) { await store.update('tires', tid, tire); throw e; }
      await log.add({ who: me, role: role, kind: 'add', title: 'Продажа б/у шин', text: log.describe('jobs', job), ch: log.snapshot('jobs', job).concat(['Остаток на складе: ' + ((t2.qty || 0) - (t2.sold || 0)) + ' шт.']), coll: 'jobs', rid: job.id });
      return send(res, 200, { ok: true, tire: t2, job: job });
    }

    // фото дисков при приёмке на покраску: у каждого заказа своя коллекция «_pp:<номер>», чтобы не грузить все фото разом
    if (b.action === 'photo-list' || b.action === 'photo-add' || b.action === 'photo-del') {
      if (role !== 'owner') return send(res, 403, { ok: false, error: 'forbidden' });
      const pid = Number(b.paint);
      if (!Number.isInteger(pid) || pid < 1) return send(res, 400, { ok: false, error: 'id' });
      const order = (await store.list('paint')).find(function (x) { return x.id === pid; });
      if (!order) return send(res, 404, { ok: false, error: 'not-found' });
      const pc = '_pp:' + pid;
      if (b.action === 'photo-list') return send(res, 200, { ok: true, photos: await store.list(pc) });
      let n;
      if (b.action === 'photo-add') {
        const img = String(b.img || '');
        if (img.length > 700000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(img)) return send(res, 400, { ok: false, error: 'field', field: 'img' });
        if ((await store.list(pc)).length >= 12) return send(res, 400, { ok: false, error: 'field', field: 'img' });
        const doc = await store.insert(pc, { img: img, at: new Date().toISOString() });
        n = (await store.list(pc)).length;
        const o2 = await store.update('paint', pid, Object.assign({}, order, { photos: n }));
        await log.add({ who: me, role: role, kind: 'add', title: 'Фото дисков добавлено', text: log.describe('paint', order) + ' · фото: ' + n, coll: 'paint', rid: pid });
        return send(res, 200, { ok: true, photo: doc, doc: o2 });
      }
      const phid = Number(b.id);
      if (!Number.isInteger(phid) || phid < 1) return send(res, 400, { ok: false, error: 'id' });
      await store.remove(pc, phid);
      n = (await store.list(pc)).length;
      const o3 = await store.update('paint', pid, Object.assign({}, order, { photos: n }));
      await log.add({ who: me, role: role, kind: 'del', title: 'Фото дисков удалено', text: log.describe('paint', order) + ' · осталось фото: ' + n, coll: 'paint', rid: pid });
      return send(res, 200, { ok: true, doc: o3 });
    }

    const coll = String(b.coll || '');
    if (COLLS.indexOf(coll) < 0) return send(res, 400, { ok: false, error: 'coll' });
    const id = b.id == null ? null : Number(b.id);
    if (id !== null && (!Number.isInteger(id) || id < 1)) return send(res, 400, { ok: false, error: 'id' });

    if (b.action === 'save') {
      if (role !== 'owner' && MASTER_WRITE.indexOf(coll) < 0) return send(res, 403, { ok: false, error: 'forbidden' });
      if (role === 'booker' && BOOKER_WRITE.indexOf(coll) < 0) return send(res, 403, { ok: false, error: 'forbidden' });
      const input = Object.assign({}, b.data && typeof b.data === 'object' ? b.data : {});
      // работа из нескольких услуг: название — все услуги через запятую, остальные поля — по первой услуге
      if (coll === 'jobs' && Array.isArray(input.items) && input.items.length) {
        const first = input.items[0] || {};
        input.service = input.items.map(function (x) { return String((x && x.service) || '').trim(); }).filter(Boolean).join(', ').slice(0, 400);
        input.qty = first.qty; input.price = first.price; input.unit = first.unit;
      }
      const c = schema.clean(coll, input);
      if (c.error) return send(res, 400, { ok: false, error: 'field', field: c.error });
      const data = c.data;
      // как запись выглядела до правки — для журнала
      const prev = id === null || coll === 'queue' ? null : (await store.list(coll)).find(function (x) { return x.id === id; }) || null;
      let booking = null; // запись, из которой создана работа: после сохранения ставим ей «Приехал»
      if (coll === 'jobs') {
        const old = id === null ? null : (await store.list('jobs')).find(function (x) { return x.id === id; });
        if (id !== null && !old) return send(res, 404, { ok: false, error: 'not-found' });
        // мастер записывает и правит только сегодняшние работы, прошлые дни — владелец
        if (role !== 'owner' && (data.date !== today() || (old && old.date !== today()))) return send(res, 403, { ok: false, error: 'old-job' });
        // продажа шин создаётся только через «sell»; при правке работы её вид и шина сохраняются
        data.kind = old && old.kind ? old.kind : 'work';
        data.tire = old && old.tire ? old.tire : 0;
        if (data.kind === 'sale') {
          // в продаже нельзя менять название и количество шин, иначе склад разойдётся с кассой; цену, оплату и прочее — можно
          const ol = old.items && old.items[0] ? old.items[0] : { service: old.service, qty: old.qty, price: old.price, unit: old.unit };
          const line = { service: ol.service, qty: ol.qty, price: data.items[0] ? data.items[0].price : data.price, unit: '1 колесо' };
          data.items = [line]; data.service = line.service; data.qty = line.qty; data.price = line.price; data.unit = line.unit;
        }
        // мастер и сотрудники не меняют цену услуги из прайса; ручная цена — только у услуг с ценой «от» и без цены
        if (role !== 'owner' && data.kind !== 'sale' && Array.isArray(data.items)) {
          const prices = await store.list('prices');
          data.items.forEach(function (it) {
            const p = prices.find(function (x) { return x.name === it.service; });
            if (p && p.price > 0 && !priceFrom(p)) { it.price = p.price; it.unit = p.unit; }
          });
          if (data.items[0]) { data.price = data.items[0].price; data.unit = data.items[0].unit; }
        }
        // безнал: нужна компания из справочника; при другой оплате компания не хранится
        if (data.pay === 'Безнал') {
          if (!data.company || !(await store.list('companies')).some(function (x) { return x.id === data.company; })) return send(res, 400, { ok: false, error: 'field', field: 'company' });
        } else data.company = 0;
        data.sum = schema.jobSum(data);
        if (data.sum < 0) return send(res, 400, { ok: false, error: 'field', field: 'adjust' });
        // работа уже в счёте: сумму, оплату и компанию не меняем (иначе счёт разойдётся с работами); сначала удалить счёт
        if (old && (data.sum !== old.sum || data.pay !== old.pay || data.company !== (old.company || 0)) &&
          (await store.list('invoices')).some(function (v) { return String(v.jobs || '').split(',').map(Number).indexOf(old.id) >= 0; })) return send(res, 409, { ok: false, error: 'in-invoice' });
        // процент мастера запоминается в работе: смена процента не меняет прошлые месяцы
        if (data.kind === 'sale') data.pct = 0;
        else if (old && Number.isInteger(old.pct)) data.pct = old.pct;
        else { const st = (await store.list('settings'))[0]; data.pct = st && Number.isInteger(st.masterPct) ? st.masterPct : 50; }
        // кто записал и кто последним правил
        const now = new Date().toISOString();
        data.by = old ? old.by || '' : me;
        data.created = old ? old.created || '' : now;
        if (old) { data.editedBy = me; data.edited = now; }
        const bid = old ? old.booking || 0 : Number(input.booking);
        data.booking = Number.isInteger(bid) && bid > 0 ? bid : 0;
        if (!old && data.booking) booking = (await store.list('bookings')).find(function (x) { return x.id === data.booking; }) || null;
      }
      if (coll === 'expenses') {
        // расход из кассы: мастер записывает и правит только сегодняшние, прошлые дни — владелец
        const old = id === null ? null : (await store.list('expenses')).find(function (x) { return x.id === id; });
        if (id !== null && !old) return send(res, 404, { ok: false, error: 'not-found' });
        if (role !== 'owner' && (data.date !== today() || (old && old.date !== today()))) return send(res, 403, { ok: false, error: 'old-job' });
        const now = new Date().toISOString();
        data.by = old ? old.by || '' : me;
        data.created = old ? old.created || '' : now;
        if (old) { data.editedBy = me; data.edited = now; }
      }
      if (coll === 'tires') {
        const m = /R\s*(\d{2})/i.exec(data.size);
        data.radius = m ? Number(m[1]) : 0;
        // мастер не меняет «принято» и «продано» у уже принятых шин: остаток уменьшается только продажей
        if (role !== 'owner') {
          const old = id === null ? null : (await store.list('tires')).find(function (x) { return x.id === id; });
          if (old) { data.qty = old.qty || 0; data.sold = old.sold || 0; } else data.sold = 0;
        }
        if (data.sold > data.qty) return send(res, 400, { ok: false, error: 'field', field: 'sold' });
      }
      if (coll === 'storage') {
        // оплата хранения попадает в кассу того дня, когда её внесли
        // (у старых записей без даты оплаты — дата приёма, как считалось раньше)
        const old = id === null ? null : (await store.list('storage')).find(function (x) { return x.id === id; });
        if (!data.paid) data.paidOn = '';
        else if (!data.paidOn) data.paidOn = old && old.paid ? old.paidOn || old.received : today();
      }
      if (coll === 'paint') {
        const old = id === null ? null : (await store.list('paint')).find(function (x) { return x.id === id; });
        if (id !== null && !old) return send(res, 404, { ok: false, error: 'not-found' });
        if (data.price && data.prepaid > data.price) return send(res, 400, { ok: false, error: 'field', field: 'prepaid' });
        // аванс идёт в кассу покраски в тот день, когда его внесли
        if (!data.prepaid) data.prepaidOn = '';
        else data.prepaidOn = old && old.prepaid ? old.prepaidOn || old.received : today();
        // когда стало «Готово» (сколько лежит у нас) и когда выдали (остаток — в кассу этого дня)
        const ready = data.status === 'Готово' || data.status === 'Выдано';
        data.readyOn = ready ? (old && old.readyOn) || today() : '';
        data.issued = data.status === 'Выдано' ? (old && old.issued) || today() : '';
        data.photos = old ? old.photos || 0 : 0;
        const now = new Date().toISOString();
        data.by = old ? old.by || '' : me;
        data.created = old ? old.created || '' : now;
      }
      if (coll === 'clients') {
        const dup = (await store.list('clients')).find(function (x) { return x.plate === data.plate && x.id !== id; });
        if (dup) return send(res, 409, { ok: false, error: 'plate', id: dup.id });
      }
      if (coll === 'bookings' && id === null && !data.created) data.created = new Date().toISOString();
      if (coll === 'bookings' && id !== null) {
        // время создания и источник записи сохраняем как были
        const old = (await store.list('bookings')).find(function (x) { return x.id === id; });
        if (old) { data.created = old.created || ''; data.source = old.source || data.source; }
      }
      if (coll === 'settings' && id === null) return send(res, 400, { ok: false, error: 'id' });
      if (coll === 'shop') {
        // реквизиты мастерской — одна запись на всю CRM
        const sh = (await store.list('shop'))[0];
        const doc = sh ? await store.update('shop', sh.id, data) : await store.insert('shop', data);
        await log.change(me, role, 'shop', sh || null, doc);
        return send(res, 200, { ok: true, doc: doc });
      }
      if (coll === 'invoices') {
        // счёт: только безнальные работы этой компании, каждая работа — не больше чем в одном счёте; сумму считает сервер
        const ids = Array.from(new Set(data.jobs.split(',').map(Number).filter(function (n) { return Number.isInteger(n) && n > 0; })));
        if (!ids.length || ids.length > 300) return send(res, 400, { ok: false, error: 'field', field: 'jobs' });
        if (!(await store.list('companies')).some(function (x) { return x.id === data.company; })) return send(res, 400, { ok: false, error: 'field', field: 'company' });
        const all = await store.list('jobs'), invs = await store.list('invoices');
        const js = ids.map(function (n) { return all.find(function (j) { return j.id === n; }); });
        if (js.some(function (j) { return !j || j.pay !== 'Безнал' || j.company !== data.company; })) return send(res, 400, { ok: false, error: 'field', field: 'jobs' });
        const busy = invs.find(function (v) { return v.id !== id && String(v.jobs || '').split(',').map(Number).some(function (n) { return ids.indexOf(n) >= 0; }); });
        if (busy) return send(res, 409, { ok: false, error: 'in-invoice', id: busy.id });
        const old = id === null ? null : invs.find(function (x) { return x.id === id; });
        if (id !== null && !old) return send(res, 404, { ok: false, error: 'not-found' });
        data.jobs = ids.join(',');
        data.sum = js.reduce(function (a, j) { return a + (j.sum || 0); }, 0);
        if (!data.paid) data.paidOn = '';
        else if (!data.paidOn) data.paidOn = old && old.paid ? old.paidOn || today() : today();
        data.by = old ? old.by || '' : me;
        data.created = old ? old.created || '' : new Date().toISOString();
      }
      if (coll === 'queue') {
        // очередь на сайте: одна запись на всю мастерскую, время и автора ставит сервер
        const q = (await store.list('queue'))[0];
        data.at = new Date().toISOString(); data.by = me;
        const doc = q ? await store.update('queue', q.id, data) : await store.insert('queue', data);
        await log.change(me, role, 'queue', q || null, doc);
        return send(res, 200, { ok: true, doc: doc });
      }
      if (coll === 'staff') {
        // код: ровно 4 цифры; у нового сотрудника обязателен, при правке пустой — оставить прежний
        const pin = String((b.data && b.data.pin) || '');
        const staff = await store.list('staff');
        const old = id === null ? null : staff.find(function (x) { return x.id === id; });
        if (id !== null && !old) return send(res, 404, { ok: false, error: 'not-found' });
        if (pin || id === null) {
          if (!/^\d{4}$/.test(pin)) return send(res, 400, { ok: false, error: 'field', field: 'pin' });
          const h = auth.pinHash(pin);
          if (auth.roleFor(pin) || auth.isOwnerPin(pin) || staff.some(function (x) { return x.pinHash === h && x.id !== id; })) return send(res, 409, { ok: false, error: 'pin-taken' });
          data.pinHash = h;
        } else data.pinHash = old.pinHash;
      }
      const doc = id === null ? await store.insert(coll, data) : await store.update(coll, id, data);
      if (!doc) return send(res, 404, { ok: false, error: 'not-found' });
      await log.change(me, role, coll, prev, doc);
      let bk = null;
      if (booking && booking.status !== 'Приехал') bk = await store.update('bookings', booking.id, Object.assign({}, booking, { status: 'Приехал' }));
      if (bk) await log.change(me, role, 'bookings', booking, bk);
      if (bk) return send(res, 200, { ok: true, doc: doc, booking: bk });
      if (coll === 'staff') return send(res, 200, { ok: true, doc: { id: doc.id, name: doc.name, access: doc.access || 'Мастер' } });
      return send(res, 200, { ok: true, doc: doc });
    }

    if (b.action === 'remove') {
      if (role !== 'owner') return send(res, 403, { ok: false, error: 'forbidden' });
      if (id === null || coll === 'settings') return send(res, 400, { ok: false, error: 'id' });
      // компанию с работами или счетами не удаляем — иначе старые счета не распечатать
      if (coll === 'companies' && ((await store.list('jobs')).some(function (j) { return j.company === id; }) || (await store.list('invoices')).some(function (v) { return v.company === id; }))) return send(res, 409, { ok: false, error: 'in-use' });
      // работу из счёта не удаляем, пока не удалён счёт
      if (coll === 'jobs' && (await store.list('invoices')).some(function (v) { return String(v.jobs || '').split(',').map(Number).indexOf(id) >= 0; })) return send(res, 409, { ok: false, error: 'in-invoice' });
      // удалили продажу шин — шины возвращаются на склад
      let back = null;
      if (coll === 'jobs') {
        const j = (await store.list('jobs')).find(function (x) { return x.id === id; });
        if (j && j.kind === 'sale' && j.tire) {
          const t = (await store.list('tires')).find(function (x) { return x.id === j.tire; });
          const n = (j.items && j.items[0] ? j.items[0].qty : j.qty) || 0;
          if (t && n) back = { t: t, n: n };
        }
      }
      const gone = (await store.list(coll)).find(function (x) { return x.id === id; }) || null; // для журнала
      const done = await store.remove(coll, id);
      if (done && gone) await log.change(me, role, coll, gone, null);
      // удалили заказ на покраску — удаляем и его фото
      if (done && coll === 'paint') for (const ph of await store.list('_pp:' + id)) await store.remove('_pp:' + id, ph.id);
      if (done && back) await store.update('tires', back.t.id, Object.assign({}, back.t, { sold: Math.max(0, (back.t.sold || 0) - back.n) }));
      return send(res, done ? 200 : 404, { ok: done });
    }

    return send(res, 400, { ok: false, error: 'action' });
  } catch (e) {
    console.error('CRM: ошибка', e);
    return send(res, 500, { ok: false, error: 'server' });
  }
};
