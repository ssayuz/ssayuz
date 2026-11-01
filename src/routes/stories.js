// 스토리: 24시간 뒤 사라지는 사진
const express = require('express');
const db = require('../db');
const { requireLogin } = require('../auth');
const { images: uploadImages, removeFiles } = require('../upload');
const { toInt } = require('../helpers');
const { isAdmin } = require('../moderation');

const router = express.Router();
const DAY = 24 * 60 * 60 * 1000;
const since = () => Date.now() - DAY;

function hasActiveStory(userId) {
  return !!db.prepare('SELECT 1 FROM stories WHERE user_id = ? AND created_at > ?').get(userId, since());
}

// 나와 내가 팔로우한 사람 중 스토리가 있는 사람들 (안 본 사람 먼저)
function storyTray(uid) {
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.avatar, MAX(s.created_at) AS latest,
        SUM(CASE WHEN v.story_id IS NULL THEN 1 ELSE 0 END) AS unseen
       FROM stories s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN story_views v ON v.story_id = s.id AND v.user_id = ?
       WHERE s.created_at > ? AND u.banned_at IS NULL
         AND (s.user_id = ? OR s.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?))
       GROUP BY u.id`
    )
    .all(uid, since(), uid, uid);
  const me = rows.find((r) => r.id === uid);
  const others = rows
    .filter((r) => r.id !== uid)
    .sort((a, b) => (b.unseen > 0) - (a.unseen > 0) || b.latest - a.latest);
  return { me: me || null, others };
}

// 24시간 지난 스토리와 사진 파일 정리
function cleanupStories() {
  const old = db.prepare('SELECT id, image FROM stories WHERE created_at <= ?').all(since());
  if (!old.length) return 0;
  db.prepare('DELETE FROM stories WHERE created_at <= ?').run(since());
  removeFiles(old.map((s) => s.image));
  return old.length;
}

router.get('/stories/new', requireLogin, (req, res) => {
  res.render('stories/new', { title: '스토리 올리기', error: null, caption: '' });
});

router.post('/stories/new', requireLogin, uploadImages('image', 1), (req, res) => {
  const caption = String(req.body.caption || '').trim();
  const fail = (error) => {
    removeFiles(req.uploaded);
    res.status(400).render('stories/new', { title: '스토리 올리기', error, caption });
  };
  if (!req.uploaded.length) return fail('사진을 한 장 골라 주세요.');
  if (caption.length > 100) return fail('글은 100자 이하로 써 주세요.');
  db.prepare('INSERT INTO stories (user_id, image, caption, created_at) VALUES (?, ?, ?, ?)').run(req.user.id, req.uploaded[0], caption, Date.now());
  res.redirect('/stories/@' + req.user.username);
});

router.get('/stories/@:username', (req, res) => {
  const owner = db.prepare('SELECT id, username, display_name, avatar FROM users WHERE username = ? AND banned_at IS NULL').get(String(req.params.username));
  if (!owner) return res.status(404).render('error', { title: '404', message: '없는 사람이에요.' });
  const stories = db
    .prepare('SELECT * FROM stories WHERE user_id = ? AND created_at > ? ORDER BY created_at')
    .all(owner.id, since());
  if (!stories.length) return res.status(404).render('error', { title: '스토리 없음', message: '24시간 안에 올라온 스토리가 없어요.' });

  const isOwner = !!req.user && req.user.id === owner.id;
  if (isOwner) {
    for (const s of stories) {
      s.viewers = db
        .prepare(
          `SELECT u.username, u.avatar FROM story_views v JOIN users u ON u.id = v.user_id
           WHERE v.story_id = ? AND v.user_id != ? ORDER BY v.created_at DESC`
        )
        .all(s.id, owner.id);
    }
  }
  // 처음 볼 스토리: 안 본 것 중 첫 번째
  let start = 0;
  if (req.user && !isOwner) {
    const seen = new Set(
      db.prepare(`SELECT story_id FROM story_views WHERE user_id = ? AND story_id IN (${stories.map(() => '?').join(',')})`)
        .all(req.user.id, ...stories.map((s) => s.id))
        .map((r) => r.story_id)
    );
    const i = stories.findIndex((s) => !seen.has(s.id));
    start = i === -1 ? 0 : i;
  }
  const qi = toInt(req.query.i);
  if (qi && qi <= stories.length) start = qi - 1;

  // 다음 사람 (트레이 순서대로)
  let nextUser = null;
  if (req.user) {
    const tray = storyTray(req.user.id);
    const order = [tray.me, ...tray.others].filter(Boolean).map((r) => r.username);
    const idx = order.indexOf(owner.username);
    if (idx !== -1 && idx + 1 < order.length) nextUser = order[idx + 1];
  }
  res.render('stories/view', { title: `@${owner.username}의 스토리`, owner, stories, start, isOwner, nextUser });
});

router.post('/stories/:id/seen', requireLogin, (req, res) => {
  const s = db.prepare('SELECT id FROM stories WHERE id = ? AND created_at > ?').get(toInt(req.params.id) || 0, since());
  if (s) db.prepare('INSERT OR IGNORE INTO story_views (story_id, user_id, created_at) VALUES (?, ?, ?)').run(s.id, req.user.id, Date.now());
  res.json({ ok: !!s });
});

router.post('/stories/:id/delete', requireLogin, (req, res) => {
  const s = db.prepare('SELECT * FROM stories WHERE id = ?').get(toInt(req.params.id) || 0);
  if (!s) return res.redirect('/snap');
  if (s.user_id !== req.user.id && !isAdmin(req)) return res.status(403).render('error', { title: '403', message: '내 스토리만 지울 수 있어요.' });
  db.prepare('DELETE FROM stories WHERE id = ?').run(s.id);
  removeFiles([s.image]);
  res.redirect(hasActiveStory(s.user_id) ? '/stories/@' + db.prepare('SELECT username FROM users WHERE id = ?').get(s.user_id).username : '/snap');
});

module.exports = router;
module.exports.storyTray = storyTray;
module.exports.hasActiveStory = hasActiveStory;
module.exports.cleanupStories = cleanupStories;
