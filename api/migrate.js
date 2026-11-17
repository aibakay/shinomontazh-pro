// ВРЕМЕННО, на время переезда на сервер в России. Удалить после переключения.
// Отдаёт базу CRM (таблицы crm_docs, crm_seq) по частям — её забирает сам новый сервер
// скриптом deploy/import-from-vercel.js. Работает, только если в Vercel задан MIGRATE_SECRET
// (32+ символа) и запрос пришёл с тем же секретом; иначе — 404.
const crypto = require('crypto');

function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
let pool = null;
function pg() {
  if (!pool) {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
  }
  return pool;
}

module.exports = async function handler(req, res) {
  const secret = process.env.MIGRATE_SECRET;
  if (!secret || secret.length < 32 || !process.env.DATABASE_URL) return res.status(404).json({ ok: false });
  if (!same(req.headers['x-migrate-secret'] || '', secret)) return res.status(404).json({ ok: false });
  res.setHeader('Cache-Control', 'no-store');
  const url = new URL(req.url, 'http://x');
  const part = url.searchParams.get('part');
  try {
    if (part === 'seq') {
      const r = await pg().query('select coll, n from crm_seq order by coll');
      return res.status(200).json({ ok: true, rows: r.rows });
    }
    if (part === 'count') {
      const r = await pg().query('select count(*)::int as n, coalesce(sum(length(data::text)),0)::bigint as bytes from crm_docs');
      return res.status(200).json({ ok: true, n: r.rows[0].n, bytes: Number(r.rows[0].bytes) });
    }
    if (part === 'settings') {
      // настройки входа, чтобы на новом сервере подошли те же пароль, код владельца и коды сотрудников
      const keys = ['CRM_OWNER_PASSWORD', 'CRM_MASTER_PASSWORD', 'CRM_SECRET', 'CRM_OWNER_PIN'];
      const env = {};
      keys.forEach(function (k) { if (process.env[k]) env[k] = process.env[k]; });
      return res.status(200).json({ ok: true, env: env });
    }
    // part=docs: по 1500 строк, после (coll, id)
    const ac = url.searchParams.get('coll') || '', ai = Number(url.searchParams.get('id') || -1);
    const r = await pg().query(
      'select coll, id, data, updated_at from crm_docs where (coll, id) > ($1, $2) order by coll, id limit 1500', [ac, ai]);
    return res.status(200).json({ ok: true, rows: r.rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'db' });
  }
};
