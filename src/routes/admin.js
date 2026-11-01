// 관리자: 스레드 숨기기, 계정 차단, 관리 기록
const express = require('express');
const db = require('../db');
const { requireAdmin, safeNext } = require('../auth');
const { toInt, likeEscape } = require('../helpers');
const { logAction } = require('../moderation');

const router = express.Router();
router.use('/admin', requireAdmin);
const back = (req, fallback = '/admin') => safeNext((req.body && req.body.back) || fallback);

router.get('/admin', (req, res) => {
  const tab = ['users', 'hidden', 'log'].includes(req.query.tab) ? req.query.tab : 'overview';
  const q = String(req.query.q || '').trim().slice(0, 30);
  const dayAgo = Date.now() - 86400000;
  const stats = {
    users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    banned: db.prepare('SELECT COUNT(*) AS n FROM users WHERE banned_at IS NOT NULL').get().n,
    postsToday: db.prepare('SELECT COUNT(*) AS n FROM posts WHERE created_at > ?').get(dayAgo).n,
    hidden: db.prepare('SELECT COUNT(*) AS n FROM posts WHERE hidden_at IS NOT NULL').get().n,
  };
  const data = {};
  const POST_ROW = `SELECT p.id, p.body, p.parent_id, p.hidden_at, p.deleted_at, p.created_at, u.username
    FROM posts p JOIN users u ON u.id = p.user_id`;
  if (tab === 'overview') {
    data.recent = db.prepare(`${POST_ROW} WHERE p.deleted_at IS NULL ORDER BY p.id DESC LIMIT 40`).all();
  } else if (tab === 'users') {
    const like = '%' + likeEscape(q) + '%';
    data.users = db.prepare(
      `SELECT u.id, u.username, u.display_name, u.role, u.banned_at, u.ban_reason, u.created_at,
        (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) AS posts
       FROM users u WHERE u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\'
       ORDER BY u.banned_at IS NULL, u.id DESC LIMIT 100`
    ).all(like, like);
  } else if (tab === 'hidden') {
    data.hidden = db.prepare(`${POST_ROW} WHERE p.hidden_at IS NOT NULL ORDER BY p.hidden_at DESC`).all();
  } else {
    data.log = db.prepare('SELECT l.*, u.username AS admin FROM admin_log l LEFT JOIN users u ON u.id = l.admin_id ORDER BY l.id DESC LIMIT 200').all();
  }
  res.render('admin', { title: '관리', tab, q, stats, ...data });
});

// 스레드 숨기기 / 복구 (토글)
router.post('/admin/hide', (req, res) => {
  const id = toInt(req.body.id);
  const row = id && db.prepare('SELECT hidden_at FROM posts WHERE id = ?').get(id);
  if (row) {
    const hide = !row.hidden_at;
    db.prepare('UPDATE posts SET hidden_at = ? WHERE id = ?').run(hide ? Date.now() : null, id);
    logAction(req.user.id, hide ? '숨김' : '복구', `스레드 #${id}`);
  }
  res.redirect(back(req));
});

router.post('/admin/users/:id/ban', (req, res) => {
  const u = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(toInt(req.params.id) || 0);
  const reason = String(req.body.reason || '').trim().slice(0, 100);
  if (u && u.role !== 'admin' && u.id !== req.user.id) {
    db.prepare('UPDATE users SET banned_at = ?, ban_reason = ? WHERE id = ?').run(Date.now(), reason, u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    logAction(req.user.id, '계정 차단', '@' + u.username, reason);
  }
  res.redirect(back(req, '/admin?tab=users'));
});

router.post('/admin/users/:id/unban', (req, res) => {
  const u = db.prepare('SELECT id, username FROM users WHERE id = ?').get(toInt(req.params.id) || 0);
  if (u) {
    db.prepare("UPDATE users SET banned_at = NULL, ban_reason = '' WHERE id = ?").run(u.id);
    logAction(req.user.id, '차단 해제', '@' + u.username);
  }
  res.redirect(back(req, '/admin?tab=users'));
});

router.post('/admin/users/:id/role', (req, res) => {
  const u = db.prepare('SELECT id, username, banned_at FROM users WHERE id = ?').get(toInt(req.params.id) || 0);
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  if (u && u.id !== req.user.id && !(role === 'admin' && u.banned_at)) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, u.id);
    logAction(req.user.id, role === 'admin' ? '관리자 지정' : '관리자 해제', '@' + u.username);
  }
  res.redirect(back(req, '/admin?tab=users'));
});

module.exports = router;
