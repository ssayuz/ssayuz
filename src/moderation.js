// 관리: 숨김 필터, 손님 IP 차단, 관리 기록
const crypto = require('crypto');
const db = require('./db');

const salt = db.prepare("SELECT value FROM settings WHERE key = 'ip_salt'").get().value;

function ipHash(ip) {
  return crypto.createHash('sha256').update(salt + String(ip).replace(/^::ffff:/, '')).digest('hex');
}

function isIpBanned(ip) {
  return !!db.prepare('SELECT 1 FROM ip_bans WHERE ip_hash = ?').get(ipHash(ip));
}

const isAdmin = (req) => !!req.user && req.user.role === 'admin';

// 관리자가 아니면 숨긴 항목을 빼는 SQL 조건
function visible(req, alias) {
  return isAdmin(req) ? '1 = 1' : `${alias}.hidden_at IS NULL`;
}

function logAction(adminId, action, target, note = '') {
  db.prepare('INSERT INTO admin_log (admin_id, action, target, note, created_at) VALUES (?, ?, ?, ?, ?)').run(
    adminId, action, target, String(note).slice(0, 200), Date.now()
  );
}

module.exports = { ipHash, isIpBanned, isAdmin, visible, logAction };
