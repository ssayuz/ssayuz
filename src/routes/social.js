const express = require('express');
const db = require('../db');
const { requireLogin } = require('../auth');
const { images: uploadImages, removeFiles } = require('../upload');
const { toInt, images, cooldown, likeEscape } = require('../helpers');
const { FEED_PAGE_SIZE, EXPLORE_PAGE_SIZE, CONCEPT_THRESHOLD } = require('../config');

const router = express.Router();
const notFound = (res, message = '존재하지 않는 페이지예요.') => res.status(404).render('error', { title: '404', message });
const wantsJson = (req) => req.get('x-csrf-token') !== undefined;

const POST_COLS = `p.*, u.username, u.display_name, u.avatar,
  (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes,
  (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS ccount,
  EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked`;

function getPost(id, viewerId) {
  const pid = toInt(id);
  if (!pid) return null;
  return db.prepare(`SELECT ${POST_COLS} FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?`).get(viewerId || 0, pid);
}

function recentComments(postId, limit) {
  return db
    .prepare(
      `SELECT * FROM (SELECT c.*, u.username, u.display_name, u.avatar FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ? ORDER BY c.id DESC LIMIT ?) ORDER BY id`
    )
    .all(postId, limit);
}

// ===== 홈 =====
router.get('/', (req, res) => {
  const concept = db
    .prepare(
      `SELECT p.id, p.title, p.up, p.created_at, g.slug, g.name AS gname,
        (SELECT COUNT(*) FROM gcomments c WHERE c.post_id = p.id) AS ccount
       FROM gposts p JOIN galleries g ON g.id = p.gallery_id
       WHERE p.up >= ? ORDER BY p.id DESC LIMIT 10`
    )
    .all(CONCEPT_THRESHOLD);
  const latest = db
    .prepare(
      `SELECT p.id, p.title, p.created_at, g.slug, g.name AS gname,
        (SELECT COUNT(*) FROM gcomments c WHERE c.post_id = p.id) AS ccount
       FROM gposts p JOIN galleries g ON g.id = p.gallery_id ORDER BY p.id DESC LIMIT 10`
    )
    .all();
  const galleries = db.prepare('SELECT slug, name, is_minor FROM galleries ORDER BY is_minor, id LIMIT 12').all();
  const photos = db
    .prepare(`SELECT ${POST_COLS} FROM posts p JOIN users u ON u.id = p.user_id ORDER BY likes DESC, p.id DESC LIMIT 9`)
    .all(req.user ? req.user.id : 0);
  res.render('home', { title: null, concept, latest, galleries, photos });
});

// ===== 피드 =====
router.get('/feed', (req, res) => {
  if (!req.user) return res.render('feed_guest', { title: '피드' });
  const before = toInt(req.query.before) || Number.MAX_SAFE_INTEGER;
  const uid = req.user.id;
  const posts = db
    .prepare(
      `SELECT ${POST_COLS} FROM posts p JOIN users u ON u.id = p.user_id
       WHERE (p.user_id = ? OR p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)) AND p.id < ?
       ORDER BY p.id DESC LIMIT ?`
    )
    .all(uid, uid, uid, before, FEED_PAGE_SIZE);
  for (const p of posts) p.comments = recentComments(p.id, 2);
  const suggestions = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar,
        (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers
       FROM users u WHERE u.id != ? AND u.id NOT IN (SELECT followee_id FROM follows WHERE follower_id = ?)
       ORDER BY followers DESC, u.id DESC LIMIT 5`
    )
    .all(uid, uid);
  res.render('feed', {
    title: '피드',
    posts,
    suggestions,
    nextBefore: posts.length === FEED_PAGE_SIZE ? posts[posts.length - 1].id : null,
  });
});

// ===== 탐색 =====
router.get('/explore', (req, res) => {
  const before = toInt(req.query.before) || Number.MAX_SAFE_INTEGER;
  const tag = String(req.query.tag || '').trim().replace(/^#/, '').slice(0, 30);
  const q = String(req.query.q || '').trim().slice(0, 30);
  const args = [req.user ? req.user.id : 0, before];
  let extra = '';
  if (tag) {
    extra = " AND (' ' || p.caption || ' ') LIKE ? ESCAPE '\\'";
    args.push('%#' + likeEscape(tag) + '%');
  }
  const posts = db
    .prepare(`SELECT ${POST_COLS} FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id < ?${extra} ORDER BY p.id DESC LIMIT ?`)
    .all(...args, EXPLORE_PAGE_SIZE);
  const people = q
    ? db
        .prepare(
          "SELECT id, username, display_name, avatar, bio FROM users WHERE username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' LIMIT 20"
        )
        .all('%' + likeEscape(q) + '%', '%' + likeEscape(q) + '%')
    : null;
  res.render('explore', {
    title: tag ? '#' + tag : '탐색',
    posts, tag, q, people,
    nextBefore: posts.length === EXPLORE_PAGE_SIZE ? posts[posts.length - 1].id : null,
  });
});

// ===== 새 게시물 =====
router.get('/p/new', requireLogin, (req, res) => {
  res.render('post_new', { title: '새 게시물', error: null, caption: '' });
});

router.post('/p/new', requireLogin, uploadImages('images', 10), (req, res) => {
  const caption = String(req.body.caption || '').trim();
  const fail = (error) => {
    removeFiles(req.uploaded);
    res.status(400).render('post_new', { title: '새 게시물', error, caption });
  };
  if (req.uploaded.length === 0) return fail('사진을 한 장 이상 골라 주세요.');
  if (caption.length > 2200) return fail('문구는 2,200자 이하로 입력해 주세요.');
  const r = db
    .prepare('INSERT INTO posts (user_id, caption, images, created_at) VALUES (?, ?, ?, ?)')
    .run(req.user.id, caption, JSON.stringify(req.uploaded), Date.now());
  res.redirect('/p/' + r.lastInsertRowid);
});

// ===== 게시물 보기 =====
router.get('/p/:id', (req, res) => {
  const post = getPost(req.params.id, req.user && req.user.id);
  if (!post) return notFound(res, '게시물을 찾을 수 없어요.');
  post.comments = recentComments(post.id, 500);
  const more = db
    .prepare('SELECT id, images FROM posts WHERE user_id = ? AND id != ? ORDER BY id DESC LIMIT 6')
    .all(post.user_id, post.id);
  res.render('post_view', { title: `${post.display_name}님의 게시물`, post, more });
});

// ===== 좋아요 (토글) =====
router.post('/p/:id/like', requireLogin, (req, res) => {
  const post = getPost(req.params.id, req.user.id);
  if (!post) return wantsJson(req) ? res.status(404).json({ error: 'not_found' }) : notFound(res);
  const force = req.body && req.body.force === 'like';
  let liked;
  if (post.liked && !force) {
    db.prepare('DELETE FROM likes WHERE post_id = ? AND user_id = ?').run(post.id, req.user.id);
    liked = false;
  } else {
    db.prepare('INSERT OR IGNORE INTO likes (post_id, user_id, created_at) VALUES (?, ?, ?)').run(post.id, req.user.id, Date.now());
    liked = true;
  }
  const count = db.prepare('SELECT COUNT(*) AS n FROM likes WHERE post_id = ?').get(post.id).n;
  if (wantsJson(req)) return res.json({ liked, count });
  res.redirect(req.body && req.body.back === 'feed' ? '/feed#post-' + post.id : '/p/' + post.id);
});

// ===== 댓글 =====
router.post('/p/:id/comment', requireLogin, (req, res) => {
  const post = getPost(req.params.id, req.user.id);
  if (!post) return notFound(res);
  const body = String(req.body.body || '').trim();
  if (body && body.length <= 1000 && !cooldown('comment:' + req.user.id, 1500)) {
    db.prepare('INSERT INTO comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, ?)').run(post.id, req.user.id, body, Date.now());
  }
  res.redirect('/p/' + post.id + '#comments');
});

router.post('/p/:id/comments/:cid/delete', requireLogin, (req, res) => {
  const post = getPost(req.params.id, req.user.id);
  if (!post) return notFound(res);
  const c = db.prepare('SELECT * FROM comments WHERE id = ? AND post_id = ?').get(toInt(req.params.cid) || 0, post.id);
  if (c && (c.user_id === req.user.id || post.user_id === req.user.id)) db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
  res.redirect('/p/' + post.id + '#comments');
});

router.post('/p/:id/delete', requireLogin, (req, res) => {
  const post = getPost(req.params.id, req.user.id);
  if (!post) return notFound(res);
  if (post.user_id !== req.user.id) return res.status(403).render('error', { title: '403', message: '내 게시물만 삭제할 수 있어요.' });
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  removeFiles(images(post.images));
  res.redirect('/u/' + req.user.username);
});

// ===== 프로필 =====
function getProfile(username) {
  return db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.bio, u.avatar, u.created_at,
        (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) AS post_count,
        (SELECT COUNT(*) FROM gposts p WHERE p.user_id = u.id) AS gpost_count,
        (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers,
        (SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.id) AS following
       FROM users u WHERE u.username = ?`
    )
    .get(String(username));
}

router.get('/u/:username', (req, res) => {
  const profile = getProfile(req.params.username);
  if (!profile) return notFound(res, '존재하지 않는 사용자예요.');
  const tab = req.query.tab === 'gallery' ? 'gallery' : 'posts';
  const isMe = !!req.user && req.user.id === profile.id;
  const following = req.user && !isMe
    ? !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(req.user.id, profile.id)
    : false;
  const posts = tab === 'posts'
    ? db.prepare(`SELECT ${POST_COLS} FROM posts p JOIN users u ON u.id = p.user_id WHERE p.user_id = ? ORDER BY p.id DESC LIMIT 60`)
        .all(req.user ? req.user.id : 0, profile.id)
    : [];
  const gposts = tab === 'gallery'
    ? db.prepare(
        `SELECT p.id, p.title, p.up, p.views, p.created_at, g.slug, g.name AS gname,
          (SELECT COUNT(*) FROM gcomments c WHERE c.post_id = p.id) AS ccount
         FROM gposts p JOIN galleries g ON g.id = p.gallery_id WHERE p.user_id = ? ORDER BY p.id DESC LIMIT 50`
      ).all(profile.id)
    : [];
  res.render('profile', { title: `${profile.display_name} (@${profile.username})`, profile, tab, isMe, following, posts, gposts });
});

router.get('/u/:username/:list', (req, res, next) => {
  const list = req.params.list;
  if (list !== 'followers' && list !== 'following') return next();
  const profile = getProfile(req.params.username);
  if (!profile) return notFound(res, '존재하지 않는 사용자예요.');
  const people = db
    .prepare(
      list === 'followers'
        ? `SELECT u.username, u.display_name, u.avatar, u.bio FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followee_id = ? ORDER BY f.created_at DESC`
        : `SELECT u.username, u.display_name, u.avatar, u.bio FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ? ORDER BY f.created_at DESC`
    )
    .all(profile.id);
  res.render('people', { title: `${profile.display_name}님의 ${list === 'followers' ? '팔로워' : '팔로잉'}`, profile, list, people });
});

router.post('/u/:username/follow', requireLogin, (req, res) => {
  const profile = getProfile(req.params.username);
  if (!profile) return notFound(res);
  if (profile.id !== req.user.id) {
    const exists = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(req.user.id, profile.id);
    if (exists) db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').run(req.user.id, profile.id);
    else db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)').run(req.user.id, profile.id, Date.now());
    if (wantsJson(req)) {
      const followers = db.prepare('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?').get(profile.id).n;
      return res.json({ following: !exists, followers });
    }
  }
  const back = String((req.body && req.body.back) || '');
  res.redirect(back === 'feed' ? '/feed' : '/u/' + profile.username);
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
  if (!displayName || displayName.length > 20) return fail('닉네임은 1~20자로 입력해 주세요.');
  if (bio.length > 150) return fail('소개는 150자 이하로 입력해 주세요.');
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
