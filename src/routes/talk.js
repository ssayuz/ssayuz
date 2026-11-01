// 토크: 방(room) 목록, 글, 댓글, 🔥/🧊
const express = require('express');
const db = require('../db');
const { hashPassword, verifyPassword, requireLogin } = require('../auth');
const { images: uploadImages, removeFiles } = require('../upload');
const { ipPrefix, likeEscape, toInt, cooldown, images } = require('../helpers');
const { HOT_THRESHOLD, TALK_PAGE_SIZE, TOPICS } = require('../config');

const router = express.Router();
const SLUG_RE = /^[a-z0-9_]{2,20}$/;
const ROOM_EMOJIS = ['💬', '🔥', '🎧', '🎬', '📚', '⚽', '🎨', '💸', '✈️', '🌱', '🧪', '🍀'];

const notFound = (res, message = '여긴 아무것도 없어요.') => res.status(404).render('error', { title: '404', message });
const getRoom = (slug) => db.prepare('SELECT * FROM rooms WHERE slug = ?').get(String(slug));

function getTalk(room, id) {
  const tid = toInt(id);
  if (!tid) return null;
  return db
    .prepare(
      `SELECT t.*, u.username, u.display_name, u.avatar FROM talks t LEFT JOIN users u ON u.id = t.user_id
       WHERE t.id = ? AND t.room_id = ?`
    )
    .get(tid, room.id);
}

const voterKey = (req) => (req.user ? 'u:' + req.user.id : 'ip:' + req.ip);

// 단골(로그인)이면 계정으로, 손님이면 닉네임 + 비밀번호 + IP 앞자리
function authorFields(req) {
  if (req.user) return { user_id: req.user.id, nickname: req.user.display_name, password_hash: null, ip_prefix: null };
  const nickname = String(req.body.nickname || '').trim() || '손님';
  const password = String(req.body.password || '');
  if (nickname.length > 20) return { error: '닉네임은 20자 이하로 해 주세요.' };
  if (password.length < 2 || password.length > 100) return { error: '비밀번호를 2자 이상 적어 주세요. 지울 때 필요해요.' };
  return { user_id: null, nickname, password_hash: hashPassword(password), ip_prefix: ipPrefix(req.ip) };
}

function canManage(req, item, password) {
  if (item.user_id) return !!req.user && req.user.id === item.user_id;
  return !!item.password_hash && verifyPassword(String(password || ''), item.password_hash);
}

// ===== 방 목록 =====
router.get('/', (req, res) => {
  const dayAgo = Date.now() - 86400000;
  const rooms = db
    .prepare(
      `SELECT r.*,
        (SELECT COUNT(*) FROM talks t WHERE t.room_id = r.id) AS total,
        (SELECT COUNT(*) FROM talks t WHERE t.room_id = r.id AND t.created_at > ?) AS today
       FROM rooms r ORDER BY r.is_user, today DESC, total DESC, r.id`
    )
    .all(dayAgo);
  res.render('talk/rooms', {
    title: '토크',
    official: rooms.filter((r) => !r.is_user),
    custom: rooms.filter((r) => r.is_user),
  });
});

// ===== 방 만들기 =====
router.get('/new', requireLogin, (req, res) => {
  res.render('talk/new', { title: '방 만들기', error: null, form: { emoji: ROOM_EMOJIS[0] }, emojis: ROOM_EMOJIS });
});

router.post('/new', requireLogin, (req, res) => {
  const slug = String(req.body.slug || '').trim().toLowerCase();
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim();
  const emoji = ROOM_EMOJIS.includes(req.body.emoji) ? req.body.emoji : ROOM_EMOJIS[0];
  const form = { slug, name, description, emoji };
  const fail = (error) => res.status(400).render('talk/new', { title: '방 만들기', error, form, emojis: ROOM_EMOJIS });
  if (!SLUG_RE.test(slug) || slug === 'new') return fail('주소는 영문 소문자, 숫자, _ 로 2~20자예요.');
  if (!name || name.length > 20) return fail('방 이름은 1~20자로 지어 주세요.');
  if (description.length > 100) return fail('소개는 100자 이하로 써 주세요.');
  if (getRoom(slug)) return fail('이미 있는 주소예요.');
  db.prepare('INSERT INTO rooms (slug, name, description, emoji, is_user, owner_id, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)').run(
    slug, name, description, emoji, req.user.id, Date.now()
  );
  res.redirect('/talk/' + slug);
});

// ===== 방 안 글 목록 =====
router.get('/:slug', (req, res) => {
  const room = getRoom(req.params.slug);
  if (!room) return notFound(res, '없는 방이에요.');

  const sort = req.query.sort === 'hot' ? 'hot' : 'new';
  const topic = TOPICS.includes(req.query.topic) ? req.query.topic : '';
  const q = String(req.query.q || '').trim().slice(0, 50);
  const page = toInt(req.query.page) || 1;

  const where = ['t.room_id = ?'];
  const args = [room.id];
  if (sort === 'hot') { where.push('t.fire - t.ice >= ?'); args.push(HOT_THRESHOLD); }
  if (topic) { where.push('t.topic = ?'); args.push(topic); }
  if (q) {
    where.push("(t.title LIKE ? ESCAPE '\\' OR t.body LIKE ? ESCAPE '\\' OR t.nickname LIKE ? ESCAPE '\\')");
    const like = '%' + likeEscape(q) + '%';
    args.push(like, like, like);
  }
  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM talks t WHERE ${whereSql}`).get(...args).n;
  const talks = db
    .prepare(
      `SELECT t.id, t.topic, t.title, substr(t.body, 1, 120) AS excerpt, t.nickname, t.ip_prefix, t.user_id,
        t.views, t.fire, t.ice, t.created_at, t.images, u.username, u.display_name, u.avatar,
        (SELECT COUNT(*) FROM talk_comments c WHERE c.talk_id = t.id) AS ccount
       FROM talks t LEFT JOIN users u ON u.id = t.user_id
       WHERE ${whereSql} ORDER BY t.id DESC LIMIT ? OFFSET ?`
    )
    .all(...args, TALK_PAGE_SIZE, (page - 1) * TALK_PAGE_SIZE);

  res.render('talk/room', {
    title: room.name,
    room, talks, sort, topic, q, page, total,
    pages: Math.max(1, Math.ceil(total / TALK_PAGE_SIZE)),
    topics: TOPICS, threshold: HOT_THRESHOLD,
  });
});

// ===== 글쓰기 =====
router.get('/:slug/write', (req, res) => {
  const room = getRoom(req.params.slug);
  if (!room) return notFound(res, '없는 방이에요.');
  res.render('talk/write', { title: '글쓰기 · ' + room.name, room, topics: TOPICS, error: null, form: {} });
});

router.post('/:slug/write', (req, res, next) => {
  if (!getRoom(req.params.slug)) return notFound(res, '없는 방이에요.');
  next();
}, uploadImages('images', 10), (req, res) => {
  const room = getRoom(req.params.slug);
  const title = String(req.body.title || '').trim();
  const body = String(req.body.body || '').trim();
  const topic = TOPICS.includes(req.body.topic) ? req.body.topic : TOPICS[0];
  const form = { title, body, topic, nickname: req.body.nickname };
  const fail = (error) => {
    removeFiles(req.uploaded);
    res.status(400).render('talk/write', { title: '글쓰기 · ' + room.name, room, topics: TOPICS, error, form });
  };

  if (!title || title.length > 80) return fail('제목은 1~80자로 써 주세요.');
  if (!body && req.uploaded.length === 0) return fail('내용을 쓰거나 이미지를 붙여 주세요.');
  if (body.length > 20000) return fail('내용이 너무 길어요. (최대 20,000자)');
  const a = authorFields(req);
  if (a.error) return fail(a.error);
  const wait = cooldown('talk:' + (req.user ? 'u' + req.user.id : req.ip), req.user ? 5000 : 15000);
  if (wait) return fail(`숨 좀 고르고 ${wait}초 뒤에 다시 써 주세요.`);

  const r = db
    .prepare(
      `INSERT INTO talks (room_id, user_id, nickname, password_hash, ip_prefix, topic, title, body, images, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(room.id, a.user_id, a.nickname, a.password_hash, a.ip_prefix, topic, title, body, JSON.stringify(req.uploaded), Date.now());
  res.redirect(`/talk/${room.slug}/${r.lastInsertRowid}`);
});

// ===== 글 보기 =====
router.get('/:slug/:id', (req, res) => {
  const room = getRoom(req.params.slug);
  if (!room) return notFound(res, '없는 방이에요.');
  const talk = getTalk(room, req.params.id);
  if (!talk) return notFound(res, '지워졌거나 없는 글이에요.');

  db.prepare('UPDATE talks SET views = views + 1 WHERE id = ?').run(talk.id);
  talk.views += 1;
  const comments = db
    .prepare(
      `SELECT c.*, u.username, u.display_name, u.avatar FROM talk_comments c LEFT JOIN users u ON u.id = c.user_id
       WHERE c.talk_id = ? ORDER BY c.id`
    )
    .all(talk.id);
  const myVote = db.prepare('SELECT dir FROM talk_votes WHERE talk_id = ? AND voter = ?').get(talk.id, voterKey(req));
  const around = db
    .prepare(
      `SELECT id, title, fire, ice FROM talks WHERE room_id = ? AND id != ? ORDER BY ABS(id - ?) LIMIT 4`
    )
    .all(room.id, talk.id, talk.id);

  res.render('talk/view', {
    title: talk.title + ' · ' + room.name,
    room, talk, comments, around,
    imgs: images(talk.images),
    myVote: myVote ? myVote.dir : 0,
    hot: talk.fire - talk.ice >= HOT_THRESHOLD,
    threshold: HOT_THRESHOLD,
    msg: req.query.msg || '',
  });
});

// ===== 🔥 불지피기 / 🧊 찬물 =====
router.post('/:slug/:id/vote', (req, res) => {
  const room = getRoom(req.params.slug);
  const talk = room && getTalk(room, req.params.id);
  if (!talk) return notFound(res);
  const dir = req.body.dir === 'ice' ? -1 : 1;
  const r = db.prepare('INSERT OR IGNORE INTO talk_votes (talk_id, voter, dir, created_at) VALUES (?, ?, ?, ?)').run(talk.id, voterKey(req), dir, Date.now());
  if (r.changes) db.prepare(`UPDATE talks SET ${dir === 1 ? 'fire = fire + 1' : 'ice = ice + 1'} WHERE id = ?`).run(talk.id);
  res.redirect(`/talk/${room.slug}/${talk.id}${r.changes ? '' : '?msg=voted'}#heat`);
});

// ===== 댓글 =====
router.post('/:slug/:id/comment', (req, res) => {
  const room = getRoom(req.params.slug);
  const talk = room && getTalk(room, req.params.id);
  if (!talk) return notFound(res);
  const body = String(req.body.body || '').trim();
  const back = (msg) => res.redirect(`/talk/${room.slug}/${talk.id}${msg ? '?msg=' + msg : ''}#comments`);
  if (!body || body.length > 1000) return back('comment_len');
  const a = authorFields(req);
  if (a.error) return back('comment_pw');
  if (cooldown('tcomment:' + (req.user ? 'u' + req.user.id : req.ip), 3000)) return back('slow');
  db.prepare(
    'INSERT INTO talk_comments (talk_id, user_id, nickname, password_hash, ip_prefix, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(talk.id, a.user_id, a.nickname, a.password_hash, a.ip_prefix, body, Date.now());
  back();
});

router.post('/:slug/:id/comments/:cid/delete', (req, res) => {
  const room = getRoom(req.params.slug);
  const talk = room && getTalk(room, req.params.id);
  if (!talk) return notFound(res);
  const c = db.prepare('SELECT * FROM talk_comments WHERE id = ? AND talk_id = ?').get(toInt(req.params.cid) || 0, talk.id);
  if (!c) return res.redirect(`/talk/${room.slug}/${talk.id}#comments`);
  if (!canManage(req, c, req.body.password)) return res.redirect(`/talk/${room.slug}/${talk.id}?msg=bad_pw#comments`);
  db.prepare('DELETE FROM talk_comments WHERE id = ?').run(c.id);
  res.redirect(`/talk/${room.slug}/${talk.id}#comments`);
});

// ===== 글 지우기 =====
router.post('/:slug/:id/delete', (req, res) => {
  const room = getRoom(req.params.slug);
  const talk = room && getTalk(room, req.params.id);
  if (!talk) return notFound(res);
  if (!canManage(req, talk, req.body.password)) return res.redirect(`/talk/${room.slug}/${talk.id}?msg=bad_pw`);
  db.prepare('DELETE FROM talks WHERE id = ?').run(talk.id);
  removeFiles(images(talk.images));
  res.redirect('/talk/' + room.slug);
});

module.exports = router;
