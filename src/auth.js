const crypto = require('crypto');
const db = require('./db');
const { COOKIE_SECURE } = require('./config');

const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  if (!stored || typeof pw !== 'string') return false;
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(res, userId) {
  const sid = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (id, user_id, created_at) VALUES (?, ?, ?)').run(sha(sid), userId, Date.now());
  res.cookie('sid', sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: SESSION_TTL,
    path: '/',
  });
}

function destroySession(req, res) {
  const sid = req.cookies.sid;
  if (sid) db.prepare('DELETE FROM sessions WHERE id = ?').run(sha(sid));
  res.clearCookie('sid', { path: '/' });
}

function loadSession(req, res, next) {
  req.user = null;
  const sid = req.cookies.sid;
  if (typeof sid === 'string' && /^[a-f0-9]{64}$/.test(sid)) {
    const row = db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.bio, u.avatar, u.role, u.banned_at, s.created_at AS s_created
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`
      )
      .get(sha(sid));
    if (row && Date.now() - row.s_created < SESSION_TTL && !row.banned_at) req.user = row;
  }
  res.locals.user = req.user;
  res.locals.isAdmin = !!req.user && req.user.role === 'admin';
  res.locals.unreadNotes = 0;
  res.locals.unreadDms = 0;
  if (req.user && req.method === 'GET') {
    res.locals.unreadNotes = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user.id).n;
    res.locals.unreadDms = db
      .prepare(
        `SELECT COUNT(*) AS n FROM dm_messages m JOIN dm_threads t ON t.id = m.thread_id
         WHERE (t.user_a = ? OR t.user_b = ?) AND m.sender_id != ? AND m.read_at IS NULL`
      )
      .get(req.user.id, req.user.id, req.user.id).n;
  }
  next();
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// Double-submit CSRF 토큰. multipart 폼은 action URL에 ?_csrf= 를 붙인다.
function csrf(req, res, next) {
  let token = req.cookies.csrf;
  if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) {
    token = crypto.randomBytes(24).toString('hex');
    res.cookie('csrf', token, { httpOnly: true, sameSite: 'lax', secure: COOKIE_SECURE, path: '/' });
  }
  res.locals.csrf = token;

  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const sent = (req.body && req.body._csrf) || req.query._csrf || req.get('x-csrf-token');
    if (!sent || !req.cookies.csrf || !safeEqual(sent, req.cookies.csrf)) {
      if (req.get('x-csrf-token') !== undefined || req.accepts(['html', 'json']) === 'json') {
        return res.status(403).json({ error: 'csrf' });
      }
      return res.status(403).render('error', {
        title: '요청 만료',
        message: '요청이 만료되었어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.',
      });
    }
  }
  next();
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  if (req.get('x-csrf-token') !== undefined) return res.status(401).json({ error: 'login' });
  res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  res.status(403).render('error', { title: '403', message: '관리자만 볼 수 있어요.' });
}

function safeNext(n) {
  return typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/';
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  loadSession,
  csrf,
  requireLogin,
  requireAdmin,
  safeNext,
};
