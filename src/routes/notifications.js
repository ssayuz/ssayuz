// 알림 목록
const express = require('express');
const db = require('../db');
const { requireLogin } = require('../auth');

const router = express.Router();

router.get('/notifications', requireLogin, (req, res) => {
  const notes = db
    .prepare(
      `SELECT n.*, u.avatar FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
       WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 100`
    )
    .all(req.user.id);
  db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(Date.now(), req.user.id);
  res.locals.unreadNotes = 0;
  res.render('notifications', { title: '알림', notes });
});

router.post('/notifications/clear', requireLogin, (req, res) => {
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
  res.redirect('/notifications');
});

module.exports = router;
