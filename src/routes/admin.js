// 관리자: 숨기기, 계정 차단, 손님 IP 차단, 관리 기록
const express = require('express');
const db = require('../db');
const { requireAdmin, safeNext } = require('../auth');
const { toInt, likeEscape } = require('../helpers');
const { logAction } = require('../moderation');

const router = express.Router();
router.use('/admin', requireAdmin);

const KINDS = {
  talk: { table: 'talks', label: '토크 글' },
  tcomment: { table: 'talk_comments', label: '토크 댓글' },
  snap: { table: 'snaps', label: '스냅' },
  scomment: { table: 'comments', label: '스냅 댓글' },
};
const back = (req, fallback = '/admin') => safeNext(req.body.back || fallback);

router.get('/admin', (req, res) => {
  const tab = ['users', 'hidden', 'bans', 'log'].includes(req.query.tab) ? req.query.tab : 'overview';
  const q = String(req.query.q || '').trim().slice(0, 30);
  const dayAgo = Date.now() - 86400000;
  const stats = {
    users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    banned: db.prepare('SELECT COUNT(*) AS n FROM users WHERE banned_at IS NOT NULL').get().n,
    talksToday: db.prepare('SELECT COUNT(*) AS n FROM talks WHERE created_at > ?').get(dayAgo).n,
    snapsToday: db.prepare('SELECT COUNT(*) AS n FROM snaps WHERE created_at > ?').get(dayAgo).n,
    hidden: Object.values(KINDS).reduce((n, k) => n + db.prepare(`SELECT COUNT(*) AS n FROM ${k.table} WHERE hidden_at IS NOT NULL`).get().n, 0),
    ipBans: db.prepare('SELECT COUNT(*) AS n FROM ip_bans').get().n,
  };
  const data = {};
  if (tab === 'overview') {
    data.recentTalks = db.prepare(
      `SELECT t.id, t.title, t.nickname, t.ip_prefix, t.user_id, t.hidden_at, t.created_at, r.slug, u.username
       FROM talks t JOIN rooms r ON r.id = t.room_id LEFT JOIN users u ON u.id = t.user_id ORDER BY t.id DESC LIMIT 15`
    ).all();
    data.recentSnaps = db.prepare(
      `SELECT s.id, s.caption, s.hidden_at, s.created_at, u.username FROM snaps s JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 15`
    ).all();
  } else if (tab === 'users') {
    const like = '%' + likeEscape(q) + '%';
    data.users = db.prepare(
      `SELECT u.id, u.username, u.display_name, u.role, u.banned_at, u.ban_reason, u.created_at,
        (SELECT COUNT(*) FROM talks t WHERE t.user_id = u.id) AS talks,
        (SELECT COUNT(*) FROM snaps s WHERE s.user_id = u.id) AS snaps
       FROM users u WHERE u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\'
       ORDER BY u.banned_at IS NULL, u.id DESC LIMIT 100`
    ).all(like, like);
  } else if (tab === 'hidden') {
    data.hidden = [
      ...db.prepare(`SELECT 'talk' AS kind, t.id, t.title AS text, t.hidden_at, '/talk/' || r.slug || '/' || t.id AS link FROM talks t JOIN rooms r ON r.id = t.room_id WHERE t.hidden_at IS NOT NULL`).all(),
      ...db.prepare(`SELECT 'tcomment' AS kind, c.id, c.body AS text, c.hidden_at, '/talk/' || r.slug || '/' || t.id || '#c' || c.id AS link FROM talk_comments c JOIN talks t ON t.id = c.talk_id JOIN rooms r ON r.id = t.room_id WHERE c.hidden_at IS NOT NULL`).all(),
      ...db.prepare(`SELECT 'snap' AS kind, s.id, s.caption AS text, s.hidden_at, '/snap/' || s.id AS link FROM snaps s WHERE s.hidden_at IS NOT NULL`).all(),
      ...db.prepare(`SELECT 'scomment' AS kind, c.id, c.body AS text, c.hidden_at, '/snap/' || c.snap_id || '#comments' AS link FROM comments c WHERE c.hidden_at IS NOT NULL`).all(),
    ].sort((a, b) => b.hidden_at - a.hidden_at);
  } else if (tab === 'bans') {
    data.bans = db.prepare('SELECT b.*, u.username AS admin FROM ip_bans b LEFT JOIN users u ON u.id = b.admin_id ORDER BY b.id DESC').all();
  } else if (tab === 'log') {
    data.log = db.prepare('SELECT l.*, u.username AS admin FROM admin_log l LEFT JOIN users u ON u.id = l.admin_id ORDER BY l.id DESC LIMIT 200').all();
  }
  res.render('admin', { title: '관리', tab, q, stats, kinds: KINDS, ...data });
});

// 숨기기 / 복구 (토글)
router.post('/admin/hide', (req, res) => {
  const kind = KINDS[req.body.kind];
  const id = toInt(req.body.id);
  if (!kind || !id) return res.redirect(back(req));
  const row = db.prepare(`SELECT hidden_at FROM ${kind.table} WHERE id = ?`).get(id);
  if (row) {
    const hide = !row.hidden_at;
    db.prepare(`UPDATE ${kind.table} SET hidden_at = ? WHERE id = ?`).run(hide ? Date.now() : null, id);
    logAction(req.user.id, hide ? '숨김' : '복구', `${kind.label} #${id}`);
  }
  res.redirect(back(req));
});

// 계정 차단 / 해제
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

// 손님 IP 차단 (글이나 댓글을 기준으로)
router.post('/admin/ip-ban', (req, res) => {
  const table = req.body.kind === 'tcomment' ? 'talk_comments' : 'talks';
  const row = db.prepare(`SELECT ip_hash, ip_prefix, nickname FROM ${table} WHERE id = ? AND user_id IS NULL`).get(toInt(req.body.id) || 0);
  const reason = String(req.body.reason || '').trim().slice(0, 100);
  if (row && row.ip_hash) {
    db.prepare('INSERT OR IGNORE INTO ip_bans (ip_hash, ip_prefix, reason, admin_id, created_at) VALUES (?, ?, ?, ?, ?)').run(
      row.ip_hash, row.ip_prefix, reason, req.user.id, Date.now()
    );
    logAction(req.user.id, 'IP 차단', `손님 ${row.nickname} (${row.ip_prefix}.*)`, reason);
  }
  res.redirect(back(req));
});

router.post('/admin/ip-bans/:id/delete', (req, res) => {
  const b = db.prepare('SELECT * FROM ip_bans WHERE id = ?').get(toInt(req.params.id) || 0);
  if (b) {
    db.prepare('DELETE FROM ip_bans WHERE id = ?').run(b.id);
    logAction(req.user.id, 'IP 차단 해제', `${b.ip_prefix}.*`);
  }
  res.redirect('/admin?tab=bans');
});

module.exports = router;
