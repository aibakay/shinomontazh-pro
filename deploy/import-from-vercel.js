#!/usr/bin/env node
// Переезд: забрать базу CRM с Vercel (api/migrate.js) и записать в PostgreSQL этого сервера.
// Запуск на сервере:  sudo MIGRATE_SECRET=... node deploy/import-from-vercel.js [--settings]
// Локальная база ПОЛНОСТЬЮ заменяется копией из облака (перед этим делается копия в /var/backups/shinomontazh).
// --settings — заодно дописать в /etc/shinomontazh.env пароль/код владельца и CRM_SECRET с Vercel.
const fs = require('fs');
const { execSync } = require('child_process');
const SRC = process.env.MIGRATE_URL || 'https://shinomontazh-pro.vercel.app/api/migrate';
const SECRET = process.env.MIGRATE_SECRET;
const ENVF = '/etc/shinomontazh.env';
if (!SECRET) { console.error('Нужен MIGRATE_SECRET'); process.exit(1); }

function envFile() {
  const o = {};
  for (const l of fs.readFileSync(ENVF, 'utf8').split('\n')) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l); if (m) o[m[1]] = m[2]; }
  return o;
}
async function get(q) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(SRC + '?' + q, { headers: { 'X-Migrate-Secret': SECRET }, signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (i === 3) throw e; await new Promise(r => setTimeout(r, 2000 * (i + 1))); }
  }
}

(async function () {
  const env = envFile();
  const cnt = await get('part=count');
  console.log('В облаке записей:', cnt.n, '· объём ~', Math.round(cnt.bytes / 1024), 'КБ');
  const rows = [];
  let coll = '', id = -1;
  for (;;) {
    const p = await get('part=docs&coll=' + encodeURIComponent(coll) + '&id=' + id);
    if (!p.rows.length) break;
    rows.push(...p.rows);
    const last = p.rows[p.rows.length - 1]; coll = last.coll; id = Number(last.id);
    process.stdout.write('\rзабрано ' + rows.length);
  }
  console.log();
  if (rows.length !== cnt.n) throw new Error('забрано ' + rows.length + ', а в облаке ' + cnt.n + ' — повторите');
  const seq = (await get('part=seq')).rows;

  fs.mkdirSync('/var/backups/shinomontazh', { recursive: true });
  try { execSync('sudo -u postgres pg_dump -Fc shino > /var/backups/shinomontazh/before-import-' + Date.now() + '.dump', { shell: '/bin/bash' }); } catch (e) { console.warn('копия не сделана:', e.message); }

  const { Client } = require('/srv/shinomontazh/node_modules/pg');
  const c = new Client({ connectionString: env.DATABASE_URL, ssl: false });
  await c.connect();
  await c.query('create table if not exists crm_docs (coll text not null, id bigint not null, data jsonb not null, updated_at timestamptz not null default now(), primary key (coll, id));' +
    'create table if not exists crm_seq (coll text primary key, n bigint not null);');
  await c.query('begin');
  try {
    await c.query('truncate crm_docs, crm_seq');
    for (let i = 0; i < rows.length; i += 500) {
      const part = rows.slice(i, i + 500);
      const vals = [], args = [];
      part.forEach((r, k) => { vals.push('($' + (4 * k + 1) + ',$' + (4 * k + 2) + ',$' + (4 * k + 3) + ',$' + (4 * k + 4) + ')'); args.push(r.coll, r.id, JSON.stringify(r.data), r.updated_at); });
      await c.query('insert into crm_docs (coll, id, data, updated_at) values ' + vals.join(','), args);
    }
    for (const s of seq) await c.query('insert into crm_seq (coll, n) values ($1, $2)', [s.coll, s.n]);
    await c.query('commit');
  } catch (e) { await c.query('rollback'); throw e; }
  const chk = await c.query('select count(*)::int n from crm_docs');
  await c.end();
  console.log('Записано на сервер:', chk.rows[0].n, 'записей,', seq.length, 'счётчиков');

  if (process.argv.includes('--settings')) {
    const s = (await get('part=settings')).env;
    let text = fs.readFileSync(ENVF, 'utf8');
    for (const k of Object.keys(s)) {
      if (envFile()[k]) continue;
      text = text.replace(new RegExp('^# ?' + k + '=.*$', 'm'), '').replace(/\n*$/, '\n') + k + '=' + s[k] + '\n';
      fs.writeFileSync(ENVF, text);
    }
    console.log('Настройки входа перенесены:', Object.keys(s).join(', '));
  }
})().catch(e => { console.error('ОШИБКА:', e.message); process.exit(1); });
