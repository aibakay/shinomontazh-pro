// Вход в CRM: два пароля из переменных окружения и коды сотрудников (коллекция staff, права мастера).
//   CRM_OWNER_PASSWORD  — владелец: видит всё, включая кассу, зарплату и прайс
//   CRM_MASTER_PASSWORD — мастер: запись, расписание, работы, клиенты, хранение
//   CRM_SECRET          — длинная случайная строка для подписи входа (не меньше 16 символов)
// После входа браузер получает подписанную куку на 12 часов. Пароли в коде не хранятся.
const crypto = require('crypto');

const TTL = 12 * 3600;

// В интернете (Vercel) короткие пароли не принимаем: владельцу и мастеру нужно не меньше 10 символов.
// Локально (свой ПК) можно короткий, например 8585.
const MIN_PW = process.env.VERCEL ? 10 : 1;
function okPw(p) { return !!p && p.length >= MIN_PW; }
function configured() {
  return !!(process.env.CRM_SECRET && process.env.CRM_SECRET.length >= 16 && okPw(process.env.CRM_OWNER_PASSWORD));
}
function hmac(s) { return crypto.createHmac('sha256', process.env.CRM_SECRET).update(s).digest('base64url'); }
function same(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

function roleFor(password) {
  if (!password) return null;
  if (same(password, process.env.CRM_OWNER_PASSWORD)) return 'owner';
  if (okPw(process.env.CRM_MASTER_PASSWORD) && same(password, process.env.CRM_MASTER_PASSWORD)) return 'master';
  return null;
}

// Код владельца для планшета: CRM_OWNER_PIN — 4 цифры. Даёт полные права владельца,
// поэтому проверяется только вместе с защитой от перебора кодов (см. api/crm.js).
function ownerPin() { const p = String(process.env.CRM_OWNER_PIN || '').trim(); return /^\d{4}$/.test(p) ? p : ''; }
function isOwnerPin(pin) { const p = ownerPin(); return !!p && same(String(pin), p); }

// Код сотрудника (4 цифры) хранится только как подпись, сам код в базе не лежит
function pinHash(pin) { return hmac('pin:' + String(pin)); }

// sid — номер сотрудника, если вошёл по своему коду; pv — метка его кода (сменили код — старый вход перестаёт действовать)
function pinMark(hash) { return String(hash || '').slice(0, 10); }
function token(role, sid, pv) {
  const o = { r: role, e: Math.floor(Date.now() / 1000) + TTL };
  if (sid) { o.s = sid; o.v = pv || ''; }
  const p = Buffer.from(JSON.stringify(o)).toString('base64url');
  return p + '.' + hmac(p);
}

function roleOf(req) { const s = sessionOf(req); return s ? s.role : null; }

function sessionOf(req) {
  const m = /(?:^|;\s*)crm=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 2) return null;
  const good = hmac(parts[0]);
  if (parts[1].length !== good.length || !crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(good))) return null;
  try {
    const o = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!o || o.e < Date.now() / 1000) return null;
    if (o.r !== 'owner' && o.r !== 'master' && o.r !== 'booker') return null;
    return { role: o.r, sid: Number.isInteger(o.s) ? o.s : null, pv: typeof o.v === 'string' ? o.v : '' };
  } catch (e) { return null; }
}

function cookie(req, value, maxAge) {
  const https = process.env.VERCEL || /https/.test(String(req.headers['x-forwarded-proto'] || ''));
  return 'crm=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + (https ? '; Secure' : '');
}

module.exports = { TTL: TTL, configured: configured, roleFor: roleFor, token: token, roleOf: roleOf, sessionOf: sessionOf, pinHash: pinHash, isOwnerPin: isOwnerPin, pinMark: pinMark, cookie: cookie };
