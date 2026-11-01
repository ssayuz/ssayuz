// 알림 목록
const express = require('express');
const db = require('../db');
const { requireLogin } = require('../auth');

const router = express.Router();

router.get('/activity', requireLogin, (req, res) => {
  const notes = db
    .prepare(
      `SELECT n.*, u.username AS actor_username, u.display_name FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
       WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 100`
    )
    .all(req.user.id);
  db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(Date.now(), req.user.id);
  res.locals.unreadNotes = 0;
  res.render('activity', { title: '활동', notes });
});

router.post('/activity/clear', requireLogin, (req, res) => {
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
  res.redirect('/activity');
});

module.exports = router;
