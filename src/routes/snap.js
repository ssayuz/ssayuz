// 홈, 스냅(사진), 둘러보기, 프로필, 팔로우
const express = require('express');
const db = require('../db');
const { requireLogin } = require('../auth');
const { images: uploadImages, removeFiles } = require('../upload');
const { toInt, images, cooldown, likeEscape } = require('../helpers');
const { FEED_PAGE_SIZE, EXPLORE_PAGE_SIZE, HOT_THRESHOLD } = require('../config');

const router = express.Router();
const notFound = (res, message = '여긴 아무것도 없어요.') => res.status(404).render('error', { title: '404', message });
const wantsJson = (req) => req.get('x-csrf-token') !== undefined;
const viewer = (req) => (req.user ? req.user.id : 0);

const SNAP_COLS = `s.*, u.username, u.display_name, u.avatar,
  (SELECT COUNT(*) FROM likes l WHERE l.snap_id = s.id) AS likes,
  (SELECT COUNT(*) FROM comments c WHERE c.snap_id = s.id) AS ccount,
  EXISTS (SELECT 1 FROM likes l WHERE l.snap_id = s.id AND l.user_id = ?) AS liked`;

function getSnap(id, viewerId) {
  const sid = toInt(id);
  if (!sid) return null;
  return db.prepare(`SELECT ${SNAP_COLS} FROM snaps s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(viewerId || 0, sid);
}

function latestComments(snapId, limit) {
  return db
    .prepare(
      `SELECT * FROM (SELECT c.*, u.username, u.display_name, u.avatar FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.snap_id = ? ORDER BY c.id DESC LIMIT ?) ORDER BY id`
    )
    .all(snapId, limit);
}

// ===== 홈 =====
router.get('/', (req, res) => {
  const hot = db
    .prepare(
      `SELECT t.id, t.title, t.fire, t.ice, t.created_at, r.slug, r.name AS rname, r.emoji,
        (SELECT COUNT(*) FROM talk_comments c WHERE c.talk_id = t.id) AS ccount
       FROM talks t JOIN rooms r ON r.id = t.room_id
       WHERE t.created_at > ? ORDER BY (t.fire - t.ice) DESC, t.id DESC LIMIT 8`
    )
    .all(Date.now() - 7 * 86400000);
  const fresh = db
    .prepare(
      `SELECT t.id, t.title, t.created_at, r.slug, r.name AS rname, r.emoji,
        (SELECT COUNT(*) FROM talk_comments c WHERE c.talk_id = t.id) AS ccount
       FROM talks t JOIN rooms r ON r.id = t.room_id ORDER BY t.id DESC LIMIT 8`
    )
    .all();
  const rooms = db.prepare('SELECT slug, name, emoji, is_user FROM rooms ORDER BY is_user, id LIMIT 12').all();
  const snaps = db
    .prepare(`SELECT ${SNAP_COLS} FROM snaps s JOIN users u ON u.id = s.user_id ORDER BY likes DESC, s.id DESC LIMIT 8`)
    .all(viewer(req));
  res.render('home', { title: null, hot, fresh, rooms, snaps, threshold: HOT_THRESHOLD });
});

// ===== 스냅 피드 (내가 팔로우한 사람들) =====
router.get('/snap', (req, res) => {
  if (!req.user) return res.render('snap/guest', { title: '스냅' });
  const before = toInt(req.query.before) || Number.MAX_SAFE_INTEGER;
  const uid = req.user.id;
  const snaps = db
    .prepare(
      `SELECT ${SNAP_COLS} FROM snaps s JOIN users u ON u.id = s.user_id
       WHERE (s.user_id = ? OR s.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)) AND s.id < ?
       ORDER BY s.id DESC LIMIT ?`
    )
    .all(uid, uid, uid, before, FEED_PAGE_SIZE);
  for (const s of snaps) s.comment_list = latestComments(s.id, 2);
  const suggestions = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar,
        (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers
       FROM users u WHERE u.id != ? AND u.id NOT IN (SELECT followee_id FROM follows WHERE follower_id = ?)
       ORDER BY followers DESC, u.id DESC LIMIT 5`
    )
    .all(uid, uid);
  res.render('snap/feed', {
    title: '스냅',
    snaps, suggestions,
    nextBefore: snaps.length === FEED_PAGE_SIZE ? snaps[snaps.length - 1].id : null,
  });
});

// ===== 둘러보기 =====
router.get('/explore', (req, res) => {
  const before = toInt(req.query.before) || Number.MAX_SAFE_INTEGER;
  const tag = String(req.query.tag || '').trim().replace(/^#/, '').slice(0, 30);
  const q = String(req.query.q || '').trim().slice(0, 30);
  const args = [viewer(req), before];
  let extra = '';
  if (tag) {
    extra = " AND (' ' || s.caption || ' ') LIKE ? ESCAPE '\\'";
    args.push('%#' + likeEscape(tag) + '%');
  }
  const snaps = db
    .prepare(`SELECT ${SNAP_COLS} FROM snaps s JOIN users u ON u.id = s.user_id WHERE s.id < ?${extra} ORDER BY s.id DESC LIMIT ?`)
    .all(...args, EXPLORE_PAGE_SIZE);
  const like = '%' + likeEscape(q) + '%';
  const people = q
    ? db.prepare("SELECT username, display_name, avatar, bio FROM users WHERE username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' LIMIT 20").all(like, like)
    : null;
  const roomsFound = q
    ? db.prepare("SELECT slug, name, emoji, description FROM rooms WHERE name LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\' LIMIT 10").all(like, like)
    : null;
  res.render('explore', {
    title: tag ? '#' + tag : '둘러보기',
    snaps, tag, q, people, roomsFound,
    nextBefore: snaps.length === EXPLORE_PAGE_SIZE ? snaps[snaps.length - 1].id : null,
  });
});

// ===== 스냅 올리기 =====
router.get('/snap/new', requireLogin, (req, res) => {
  res.render('snap/new', { title: '스냅 올리기', error: null, caption: '' });
});

router.post('/snap/new', requireLogin, uploadImages('images', 10), (req, res) => {
  const caption = String(req.body.caption || '').trim();
  const fail = (error) => {
    removeFiles(req.uploaded);
    res.status(400).render('snap/new', { title: '스냅 올리기', error, caption });
  };
  if (req.uploaded.length === 0) return fail('사진을 한 장 이상 골라 주세요.');
  if (caption.length > 2200) return fail('글은 2,200자 이하로 써 주세요.');
  const r = db
    .prepare('INSERT INTO snaps (user_id, caption, images, created_at) VALUES (?, ?, ?, ?)')
    .run(req.user.id, caption, JSON.stringify(req.uploaded), Date.now());
  res.redirect('/snap/' + r.lastInsertRowid);
});

// ===== 스냅 보기 =====
router.get('/snap/:id', (req, res) => {
  const snap = getSnap(req.params.id, viewer(req));
  if (!snap) return notFound(res, '스냅을 찾을 수 없어요.');
  snap.comment_list = latestComments(snap.id, 500);
  const more = db
    .prepare(`SELECT ${SNAP_COLS} FROM snaps s JOIN users u ON u.id = s.user_id WHERE s.user_id = ? AND s.id != ? ORDER BY s.id DESC LIMIT 6`)
    .all(viewer(req), snap.user_id, snap.id);
  res.render('snap/view', { title: `@${snap.username}의 스냅`, snap, more });
});

// ===== 좋아요 (토글) =====
router.post('/snap/:id/like', requireLogin, (req, res) => {
  const snap = getSnap(req.params.id, req.user.id);
  if (!snap) return wantsJson(req) ? res.status(404).json({ error: 'not_found' }) : notFound(res);
  const force = req.body && req.body.force === '1';
  let on;
  if (snap.liked && !force) {
    db.prepare('DELETE FROM likes WHERE snap_id = ? AND user_id = ?').run(snap.id, req.user.id);
    on = false;
  } else {
    db.prepare('INSERT OR IGNORE INTO likes (snap_id, user_id, created_at) VALUES (?, ?, ?)').run(snap.id, req.user.id, Date.now());
    on = true;
  }
  const count = db.prepare('SELECT COUNT(*) AS n FROM likes WHERE snap_id = ?').get(snap.id).n;
  if (wantsJson(req)) return res.json({ on, count });
  res.redirect(req.body && req.body.back === 'feed' ? '/snap#snap-' + snap.id : '/snap/' + snap.id);
});

// ===== 댓글 =====
router.post('/snap/:id/comment', requireLogin, (req, res) => {
  const snap = getSnap(req.params.id, req.user.id);
  if (!snap) return notFound(res);
  const body = String(req.body.body || '').trim();
  if (body && body.length <= 1000 && !cooldown('comment:' + req.user.id, 1500)) {
    db.prepare('INSERT INTO comments (snap_id, user_id, body, created_at) VALUES (?, ?, ?, ?)').run(snap.id, req.user.id, body, Date.now());
  }
  res.redirect('/snap/' + snap.id + '#comments');
});

router.post('/snap/:id/comments/:cid/delete', requireLogin, (req, res) => {
  const snap = getSnap(req.params.id, req.user.id);
  if (!snap) return notFound(res);
  const c = db.prepare('SELECT * FROM comments WHERE id = ? AND snap_id = ?').get(toInt(req.params.cid) || 0, snap.id);
  if (c && (c.user_id === req.user.id || snap.user_id === req.user.id)) db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
  res.redirect('/snap/' + snap.id + '#comments');
});

router.post('/snap/:id/delete', requireLogin, (req, res) => {
  const snap = getSnap(req.params.id, req.user.id);
  if (!snap) return notFound(res);
  if (snap.user_id !== req.user.id) return res.status(403).render('error', { title: '403', message: '내 스냅만 지울 수 있어요.' });
  db.prepare('DELETE FROM snaps WHERE id = ?').run(snap.id);
  removeFiles(images(snap.images));
  res.redirect('/@' + req.user.username);
});

// ===== 프로필 =====
function getMember(username) {
  return db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.bio, u.avatar, u.created_at,
        (SELECT COUNT(*) FROM snaps s WHERE s.user_id = u.id) AS snap_count,
        (SELECT COUNT(*) FROM talks t WHERE t.user_id = u.id) AS talk_count,
        (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers,
        (SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.id) AS following
       FROM users u WHERE u.username = ?`
    )
    .get(String(username));
}

router.get('/@:username', (req, res) => {
  const member = getMember(req.params.username);
  if (!member) return notFound(res, '없는 사람이에요.');
  const tab = req.query.tab === 'talk' ? 'talk' : 'snap';
  const isMe = !!req.user && req.user.id === member.id;
  const following = req.user && !isMe
    ? !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(req.user.id, member.id)
    : false;
  const snaps = tab === 'snap'
    ? db.prepare(`SELECT ${SNAP_COLS} FROM snaps s JOIN users u ON u.id = s.user_id WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 60`)
        .all(viewer(req), member.id)
    : [];
  const talks = tab === 'talk'
    ? db.prepare(
        `SELECT t.id, t.title, t.fire, t.ice, t.views, t.created_at, r.slug, r.name AS rname, r.emoji,
          (SELECT COUNT(*) FROM talk_comments c WHERE c.talk_id = t.id) AS ccount
         FROM talks t JOIN rooms r ON r.id = t.room_id WHERE t.user_id = ? ORDER BY t.id DESC LIMIT 50`
      ).all(member.id)
    : [];
  res.render('member', { title: `${member.display_name} (@${member.username})`, member, tab, isMe, following, snaps, talks, threshold: HOT_THRESHOLD });
});

router.get('/@:username/:list', (req, res, next) => {
  const list = req.params.list;
  if (list !== 'followers' && list !== 'following') return next();
  const member = getMember(req.params.username);
  if (!member) return notFound(res, '없는 사람이에요.');
  const people = db
    .prepare(
      list === 'followers'
        ? `SELECT u.username, u.display_name, u.avatar, u.bio FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followee_id = ? ORDER BY f.created_at DESC`
        : `SELECT u.username, u.display_name, u.avatar, u.bio FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ? ORDER BY f.created_at DESC`
    )
    .all(member.id);
  res.render('people', { title: `@${member.username}의 ${list === 'followers' ? '팔로워' : '팔로잉'}`, member, list, people });
});

router.post('/@:username/follow', requireLogin, (req, res) => {
  const member = getMember(req.params.username);
  if (!member) return notFound(res);
  if (member.id !== req.user.id) {
    const exists = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(req.user.id, member.id);
    if (exists) db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').run(req.user.id, member.id);
    else db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)').run(req.user.id, member.id, Date.now());
    if (wantsJson(req)) {
      const followers = db.prepare('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?').get(member.id).n;
      return res.json({ following: !exists, followers });
    }
  }
  res.redirect(req.body && req.body.back === 'feed' ? '/snap' : '/@' + member.username);
});

// ===== 프로필 편집 =====
router.get('/settings', requireLogin, (req, res) => {
  res.render('settings', { title: '프로필 편집', error: null, saved: req.query.saved === '1' });
});

router.post('/settings', requireLogin, uploadImages('avatar', 1), (req, res) => {
  const displayName = String(req.body.display_name || '').trim();
  const bio = String(req.body.bio || '').trim();
  const fail = (error) => {
    removeFiles(req.uploaded);
    res.status(400).render('settings', { title: '프로필 편집', error, saved: false });
  };
  if (!displayName || displayName.length > 20) return fail('닉네임은 1~20자로 해 주세요.');
  if (bio.length > 150) return fail('소개는 150자 이하로 써 주세요.');
  let avatar = req.user.avatar;
  if (req.uploaded.length) {
    if (avatar) removeFiles([avatar]);
    avatar = req.uploaded[0];
  } else if (req.body.remove_avatar === '1' && avatar) {
    removeFiles([avatar]);
    avatar = null;
  }
  db.prepare('UPDATE users SET display_name = ?, bio = ?, avatar = ? WHERE id = ?').run(displayName, bio, avatar, req.user.id);
  res.redirect('/settings?saved=1');
});

module.exports = router;
