// DM: 1:1 메시지
const express = require('express');
const db = require('../db');
const { requireLogin } = require('../auth');
const { toInt, cooldown } = require('../helpers');

const router = express.Router();
router.use('/dm', requireLogin);
const wantsJson = (req) => req.get('x-csrf-token') !== undefined || req.query.json === '1';

const pair = (x, y) => (x < y ? [x, y] : [y, x]);

function findThread(me, other) {
  const [a, b] = pair(me, other);
  return db.prepare('SELECT * FROM dm_threads WHERE user_a = ? AND user_b = ?').get(a, b);
}

function getPartner(req, res) {
  const other = db.prepare('SELECT id, username, display_name, avatar, banned_at FROM users WHERE username = ?').get(String(req.params.username));
  if (!other) { res.status(404).render('error', { title: '404', message: '없는 사람이에요.' }); return null; }
  if (other.id === req.user.id) { res.redirect('/dm'); return null; }
  return other;
}

const MSG_COLS = 'id, sender_id, body, created_at, read_at';

function markRead(threadId, meId) {
  db.prepare('UPDATE dm_messages SET read_at = ? WHERE thread_id = ? AND sender_id != ? AND read_at IS NULL').run(Date.now(), threadId, meId);
}

// 받은 메시지함
router.get('/dm', (req, res) => {
  const me = req.user.id;
  const threads = db
    .prepare(
      `SELECT t.id, t.last_at, u.username, u.display_name, u.avatar,
        (SELECT body FROM dm_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_body,
        (SELECT sender_id FROM dm_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_sender,
        (SELECT COUNT(*) FROM dm_messages m WHERE m.thread_id = t.id AND m.sender_id != ? AND m.read_at IS NULL) AS unread
       FROM dm_threads t JOIN users u ON u.id = CASE WHEN t.user_a = ? THEN t.user_b ELSE t.user_a END
       WHERE t.user_a = ? OR t.user_b = ? ORDER BY t.last_at DESC LIMIT 100`
    )
    .all(me, me, me, me);
  res.render('dm/inbox', { title: '메시지', threads });
});

// 대화방
router.get('/dm/@:username', (req, res) => {
  const other = getPartner(req, res);
  if (!other) return;
  const thread = findThread(req.user.id, other.id);
  let messages = [];
  if (thread) {
    markRead(thread.id, req.user.id);
    messages = db
      .prepare(`SELECT * FROM (SELECT ${MSG_COLS} FROM dm_messages WHERE thread_id = ? ORDER BY id DESC LIMIT 200) ORDER BY id`)
      .all(thread.id);
  }
  res.render('dm/thread', { title: `@${other.username}와의 대화`, other, messages, error: null });
});

// 새 메시지 가져오기 (폴링)
router.get('/dm/@:username/poll', (req, res) => {
  const other = db.prepare('SELECT id FROM users WHERE username = ?').get(String(req.params.username));
  if (!other) return res.status(404).json({ error: 'not_found' });
  const thread = findThread(req.user.id, other.id);
  if (!thread) return res.json({ messages: [], readUpTo: 0 });
  const after = toInt(req.query.after) || 0;
  const messages = db.prepare(`SELECT ${MSG_COLS} FROM dm_messages WHERE thread_id = ? AND id > ? ORDER BY id LIMIT 100`).all(thread.id, after);
  markRead(thread.id, req.user.id);
  // 상대가 내 메시지를 어디까지 읽었는지
  const r = db.prepare('SELECT MAX(id) AS id FROM dm_messages WHERE thread_id = ? AND sender_id = ? AND read_at IS NOT NULL').get(thread.id, req.user.id);
  res.json({ messages, readUpTo: r.id || 0 });
});

// 보내기
router.post('/dm/@:username', (req, res) => {
  const other = getPartner(req, res);
  if (!other) return;
  const body = String(req.body.body || '').trim();
  const fail = (error, code = 400) => {
    if (wantsJson(req)) return res.status(code).json({ error });
    res.status(code).render('dm/thread', { title: `@${other.username}와의 대화`, other, messages: [], error });
  };
  if (other.banned_at) return fail('이용이 제한된 사람에게는 보낼 수 없어요.', 403);
  if (!body || body.length > 1000) return fail('메시지는 1~1000자로 보내 주세요.');
  if (cooldown('dm:' + req.user.id, 400)) return fail('너무 빨라요. 잠깐만요.', 429);

  const [a, b] = pair(req.user.id, other.id);
  const now = Date.now();
  db.prepare('INSERT INTO dm_threads (user_a, user_b, last_at) VALUES (?, ?, ?) ON CONFLICT (user_a, user_b) DO UPDATE SET last_at = excluded.last_at').run(a, b, now);
  const thread = findThread(req.user.id, other.id);
  const r = db.prepare('INSERT INTO dm_messages (thread_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)').run(thread.id, req.user.id, body, now);
  if (wantsJson(req)) {
    return res.json({ message: { id: Number(r.lastInsertRowid), sender_id: req.user.id, body, created_at: now, read_at: null } });
  }
  res.redirect('/dm/@' + other.username + '#end');
});

module.exports = router;
