// Хранилище CRM. Два режима:
//  • DATABASE_URL задан — PostgreSQL (российский хостинг, управляемая база). Таблицы создаются сами.
//  • иначе, если сайт запущен не на Vercel, — файл .data/crm.json (для разработки и проверки).
// На Vercel без DATABASE_URL хранилища нет: CRM отвечает «база не подключена».
// Каждая запись хранится как JSON-документ: коллекция + номер + данные.
const fs = require('fs');
const path = require('path');

function kind() {
  if (process.env.DATABASE_URL) return 'pg';
  if (process.env.CRM_DATA_FILE || !process.env.VERCEL) return 'file';
  return null;
}
function available() { return kind() !== null; }

// ---- PostgreSQL
let pool = null, ready = null;
function pg() {
  if (!pool) {
    const { Pool } = require('pg');
    const ssl = process.env.DATABASE_CA ? { ca: process.env.DATABASE_CA }
      : process.env.DATABASE_SSL === 'off' ? false : { rejectUnauthorized: false };
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: ssl, max: 3 });
  }
  return pool;
}
function pgReady() {
  if (!ready) {
    ready = pg().query(
      'create table if not exists crm_docs (coll text not null, id bigint not null, data jsonb not null, updated_at timestamptz not null default now(), primary key (coll, id));' +
      'create table if not exists crm_seq (coll text primary key, n bigint not null);'
    ).catch(function (e) { ready = null; throw e; });
  }
  return ready;
}

// ---- файл (запись по очереди, через временный файл)
let queue = Promise.resolve();
function filePath() { return process.env.CRM_DATA_FILE || path.join(process.cwd(), '.data', 'crm.json'); }
function readDb() {
  try { return JSON.parse(fs.readFileSync(filePath(), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return { seq: {}, docs: {} }; throw e; }
}
function writeDb(db) {
  const p = filePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p + '.tmp', JSON.stringify(db));
  fs.renameSync(p + '.tmp', p);
}
function withDb(fn) {
  const run = queue.then(function () { const db = readDb(); const out = fn(db); writeDb(db); return out; });
  queue = run.catch(function () {});
  return run;
}

function strip(data) { const o = Object.assign({}, data); delete o.id; return o; }

async function list(coll) {
  if (kind() === 'pg') {
    await pgReady();
    const r = await pg().query('select id, data from crm_docs where coll = $1 order by id', [coll]);
    return r.rows.map(function (x) { return Object.assign({}, x.data, { id: Number(x.id) }); });
  }
  await queue;
  const db = readDb();
  return Object.values(db.docs[coll] || {});
}

async function insert(coll, data) {
  if (kind() === 'pg') {
    await pgReady();
    const n = await pg().query('insert into crm_seq (coll, n) values ($1, 1) on conflict (coll) do update set n = crm_seq.n + 1 returning n', [coll]);
    const id = Number(n.rows[0].n);
    await pg().query('insert into crm_docs (coll, id, data) values ($1, $2, $3)', [coll, id, strip(data)]);
    return Object.assign(strip(data), { id: id });
  }
  return withDb(function (db) {
    db.seq[coll] = (db.seq[coll] || 0) + 1;
    const id = db.seq[coll];
    db.docs[coll] = db.docs[coll] || {};
    db.docs[coll][id] = Object.assign(strip(data), { id: id });
    return db.docs[coll][id];
  });
}

// Полная замена данных записи. Возвращает null, если записи нет.
async function update(coll, id, data) {
  if (kind() === 'pg') {
    await pgReady();
    const r = await pg().query('update crm_docs set data = $3, updated_at = now() where coll = $1 and id = $2', [coll, id, strip(data)]);
    return r.rowCount ? Object.assign(strip(data), { id: id }) : null;
  }
  return withDb(function (db) {
    if (!db.docs[coll] || !db.docs[coll][id]) return null;
    db.docs[coll][id] = Object.assign(strip(data), { id: id });
    return db.docs[coll][id];
  });
}

async function remove(coll, id) {
  if (kind() === 'pg') {
    await pgReady();
    const r = await pg().query('delete from crm_docs where coll = $1 and id = $2', [coll, id]);
    return r.rowCount > 0;
  }
  return withDb(function (db) {
    if (!db.docs[coll] || !db.docs[coll][id]) return false;
    delete db.docs[coll][id];
    return true;
  });
}

// Перенос базы: заменяет всю коллекцию записями с их прежними номерами (для переезда с ПК в облако)
async function replaceAll(coll, docs, seq) {
  if (kind() === 'pg') {
    await pgReady();
    const c = await pg().connect();
    try {
      await c.query('begin');
      await c.query('delete from crm_docs where coll = $1', [coll]);
      for (const d of docs) await c.query('insert into crm_docs (coll, id, data) values ($1, $2, $3)', [coll, d.id, strip(d)]);
      await c.query('insert into crm_seq (coll, n) values ($1, $2) on conflict (coll) do update set n = $2', [coll, seq]);
      await c.query('commit');
    } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
    return;
  }
  return withDb(function (db) {
    db.docs[coll] = {};
    for (const d of docs) db.docs[coll][d.id] = Object.assign(strip(d), { id: d.id });
    db.seq[coll] = seq;
  });
}

// Журнал: все записи коллекций с именами от from до to включительно (по алфавиту), одним запросом
async function listRange(from, to) {
  if (kind() === 'pg') {
    await pgReady();
    const r = await pg().query('select coll, id, data from crm_docs where coll >= $1 and coll <= $2 order by coll, id', [from, to]);
    return r.rows.map(function (x) { return Object.assign({}, x.data, { id: Number(x.id) }); });
  }
  await queue;
  const db = readDb(), res = [];
  Object.keys(db.docs).forEach(function (c) { if (c >= from && c <= to) Object.values(db.docs[c]).forEach(function (d) { res.push(d); }); });
  return res;
}
// Журнал: удалить целиком коллекции с именами от from (включительно) до below (не включая)
async function removeBelow(from, below) {
  if (kind() === 'pg') {
    await pgReady();
    await pg().query('delete from crm_docs where coll >= $1 and coll < $2', [from, below]);
    await pg().query('delete from crm_seq where coll >= $1 and coll < $2', [from, below]);
    return;
  }
  await queue;
  const has = Object.keys(readDb().docs).some(function (c) { return c >= from && c < below; });
  if (!has) return;
  return withDb(function (db) {
    Object.keys(db.docs).forEach(function (c) { if (c >= from && c < below) { delete db.docs[c]; delete db.seq[c]; } });
  });
}

module.exports = { listRange: listRange, removeBelow: removeBelow, kind: kind, available: available, list: list, insert: insert, update: update, remove: remove, replaceAll: replaceAll };
