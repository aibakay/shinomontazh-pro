// Сервер сайта и CRM без Vercel: для проверки на своём компьютере и для российского хостинга (VPS).
// Запуск: node server.js   (порт — PORT, по умолчанию 3000)
// Настройки берутся из переменных окружения или из файла .env.local рядом (KEY=значение, по строке).
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID         — заявки в Telegram
//   CRM_OWNER_PASSWORD, CRM_MASTER_PASSWORD, CRM_SECRET — вход в CRM
//   (очередь на сайте — /api/queue, читает её из CRM)
//   DATABASE_URL                                 — PostgreSQL; без неё данные пишутся в .data/crm.json
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
(function loadEnv() {
  const f = path.join(ROOT, '.env.local');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

const ROUTES = { '/api/lead': require('./api/lead'), '/api/crm': require('./api/crm'), '/api/queue': require('./api/queue') };
// Отдаём наружу только страницы сайта и CRM — не код сервера, не базу и не настройки
const PUBLIC = [/^\/$/, /^\/(index|privacy|consent)\.html$/, /^\/crm\/(index\.html)?$/, /^\/(photos|assets)\/[\w\-.]+$/];
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm' };

function shim(res) {
  res.status = function (code) { res.statusCode = code; return res; };
  res.json = function (obj) { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); return res; };
  return res;
}

const server = http.createServer(function (req, res) {
  shim(res);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const url = new URL(req.url, 'http://localhost');
  const route = ROUTES[url.pathname];
  if (route) {
    let size = 0; const chunks = [];
    req.on('data', function (c) { size += c.length; if (size > 1000000) { res.status(413).json({ ok: false, error: 'too large' }); req.destroy(); } else chunks.push(c); });
    req.on('end', function () {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { req.body = /json/.test(String(req.headers['content-type'] || '')) && raw ? JSON.parse(raw) : raw; } catch (e) { req.body = null; }
      Promise.resolve(route(req, res)).catch(function (e) { console.error(e); if (!res.headersSent) res.status(500).json({ ok: false, error: 'server' }); });
    });
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p === '/crm') { res.statusCode = 301; res.setHeader('Location', '/crm/'); return res.end(); }
  if (!PUBLIC.some(function (re) { return re.test(p); })) { res.statusCode = 404; return res.end('Not found'); }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, function (err, buf) {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    if (p.startsWith('/crm/')) {
      res.setHeader('X-Robots-Tag', 'noindex');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Cache-Control', 'no-store');
    }
    res.end(buf);
  });
});

const port = Number(process.env.PORT) || 3000;
// Слушаем все сети компьютера: CRM открывается и с планшета в той же Wi-Fi
server.listen(port, '0.0.0.0', function () {
  console.log('Шиномонтаж PRO: http://localhost:' + port + '  ·  CRM: http://localhost:' + port + '/crm/');
  const nets = require('os').networkInterfaces();
  for (const name in nets) for (const n of nets[name]) {
    if (n.family === 'IPv4' && !n.internal && /^192\.168\./.test(n.address)) console.log('С планшета (та же Wi-Fi): http://' + n.address + ':' + port + '/crm/');
  }
  console.log('База CRM: ' + (process.env.DATABASE_URL ? 'PostgreSQL' : 'файл .data/crm.json'));
});
