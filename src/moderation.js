// 관리: 숨김 필터, 관리 기록
const db = require('./db');

const isAdmin = (req) => !!req.user && req.user.role === 'admin';

// 관리자가 아니면 숨긴 글을 빼는 SQL 조건
function visible(req, alias) {
  return isAdmin(req) ? '1 = 1' : `${alias}.hidden_at IS NULL`;
}

function logAction(adminId, action, target, note = '') {
  db.prepare('INSERT INTO admin_log (admin_id, action, target, note, created_at) VALUES (?, ?, ?, ?, ?)').run(
    adminId, action, target, String(note).slice(0, 200), Date.now()
  );
}

module.exports = { isAdmin, visible, logAction };
