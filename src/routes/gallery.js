const express = require('express');
const db = require('../db');
const { hashPassword, verifyPassword, requireLogin } = require('../auth');
const { images: uploadImages, removeFiles } = require('../upload');
const { ipPrefix, likeEscape, toInt, cooldown, images } = require('../helpers');
const { CONCEPT_THRESHOLD, GALLERY_PAGE_SIZE, HEADS } = require('../config');

const router = express.Router();
const SLUG_RE = /^[a-z0-9_]{2,20}$/;

const notFound = (res, message = '존재하지 않는 페이지예요.') => res.status(404).render('error', { title: '404', message });

function getGallery(slug) {
  return db.prepare('SELECT * FROM galleries WHERE slug = ?').get(String(slug));
}

function getPost(gallery, id) {
  const pid = toInt(id);
  if (!pid) return null;
  return db
    .prepare(
      `SELECT p.*, u.username, u.display_name FROM gposts p LEFT JOIN users u ON u.id = p.user_id
       WHERE p.id = ? AND p.gallery_id = ?`
    )
    .get(pid, gallery.id);
}

const voterKey = (req) => (req.user ? 'u:' + req.user.id : 'ip:' + req.ip);

// 작성자 정보: 고닉이면 계정, 유동이면 닉네임 + 비밀번호 + IP 앞자리
function authorFields(req, res, errorView) {
  if (req.user) return { user_id: req.user.id, nickname: req.user.display_name, password_hash: null, ip_prefix: null };
  const nickname = String(req.body.nickname || '').trim() || 'ㅇㅇ';
  const password = String(req.body.password || '');
  if (nickname.length > 20) return { error: '닉네임은 20자 이하로 입력해 주세요.' };
  if (password.length < 2 || password.length > 100) return { error: '비밀번호를 2자 이상 입력해 주세요. (삭제할 때 필요해요)' };
  return { user_id: null, nickname, password_hash: hashPassword(password), ip_prefix: ipPrefix(req.ip) };
}

function canManage(req, item, password) {
  if (item.user_id) return !!req.user && req.user.id === item.user_id;
  return !!item.password_hash && verifyPassword(String(password || ''), item.password_hash);
}

// ===== 갤러리 목록 =====
router.get('/', (req, res) => {
  const dayAgo = Date.now() - 86400000;
  const galleries = db
    .prepare(
      `SELECT g.*,
        (SELECT COUNT(*) FROM gposts p WHERE p.gallery_id = g.id) AS total,
        (SELECT COUNT(*) FROM gposts p WHERE p.gallery_id = g.id AND p.created_at > ?) AS today
       FROM galleries g ORDER BY g.is_minor, today DESC, total DESC, g.id`
    )
    .all(dayAgo);
  res.render('gallery/index', {
    title: '갤러리',
    main: galleries.filter((g) => !g.is_minor),
    minor: galleries.filter((g) => g.is_minor),
  });
});

// ===== 마이너 갤러리 만들기 =====
router.get('/new', requireLogin, (req, res) => {
  res.render('gallery/new', { title: '마이너 갤러리 만들기', error: null, form: {} });
});

router.post('/new', requireLogin, (req, res) => {
  const slug = String(req.body.slug || '').trim().toLowerCase();
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim();
  const form = { slug, name, description };
  const fail = (error) => res.status(400).render('gallery/new', { title: '마이너 갤러리 만들기', error, form });
  if (!SLUG_RE.test(slug) || slug === 'new') return fail('주소는 영문 소문자, 숫자, _ 로 2~20자여야 해요.');
  if (!name || name.length > 20) return fail('갤러리 이름은 1~20자로 입력해 주세요.');
  if (description.length > 100) return fail('설명은 100자 이하로 입력해 주세요.');
  if (getGallery(slug)) return fail('이미 있는 주소예요.');
  db.prepare('INSERT INTO galleries (slug, name, description, is_minor, owner_id, created_at) VALUES (?, ?, ?, 1, ?, ?)').run(
    slug, name, description, req.user.id, Date.now()
  );
  res.redirect('/g/' + slug);
});

// ===== 게시글 목록 =====
router.get('/:slug', (req, res) => {
  const g = getGallery(req.params.slug);
  if (!g) return notFound(res, '존재하지 않는 갤러리예요.');

  const mode = req.query.mode === 'best' ? 'best' : 'all';
  const head = HEADS.includes(req.query.head) ? req.query.head : '';
  const q = String(req.query.q || '').trim().slice(0, 50);
  const page = toInt(req.query.page) || 1;

  const where = ['p.gallery_id = ?'];
  const args = [g.id];
  if (mode === 'best') { where.push('p.up >= ?'); args.push(CONCEPT_THRESHOLD); }
  if (head) { where.push('p.head = ?'); args.push(head); }
  if (q) {
    where.push("(p.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\' OR p.nickname LIKE ? ESCAPE '\\')");
    const like = '%' + likeEscape(q) + '%';
    args.push(like, like, like);
  }
  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM gposts p WHERE ${whereSql}`).get(...args).n;
  const posts = db
    .prepare(
      `SELECT p.id, p.head, p.title, p.nickname, p.ip_prefix, p.user_id, p.views, p.up, p.created_at,
        p.images != '[]' AS has_img, u.username, u.display_name,
        (SELECT COUNT(*) FROM gcomments c WHERE c.post_id = p.id) AS ccount
       FROM gposts p LEFT JOIN users u ON u.id = p.user_id
       WHERE ${whereSql} ORDER BY p.id DESC LIMIT ? OFFSET ?`
    )
    .all(...args, GALLERY_PAGE_SIZE, (page - 1) * GALLERY_PAGE_SIZE);

  res.render('gallery/list', {
    title: g.name + ' 갤러리',
    g, posts, mode, head, q, page,
    pages: Math.max(1, Math.ceil(total / GALLERY_PAGE_SIZE)),
    total, heads: HEADS, threshold: CONCEPT_THRESHOLD,
  });
});

// ===== 글쓰기 =====
router.get('/:slug/write', (req, res) => {
  const g = getGallery(req.params.slug);
  if (!g) return notFound(res, '존재하지 않는 갤러리예요.');
  res.render('gallery/write', { title: '글쓰기 - ' + g.name, g, heads: HEADS, error: null, form: {} });
});

router.post('/:slug/write', (req, res, next) => {
  if (!getGallery(req.params.slug)) return notFound(res, '존재하지 않는 갤러리예요.');
  next();
}, uploadImages('images', 10), (req, res) => {
  const g = getGallery(req.params.slug);
  const title = String(req.body.title || '').trim();
  const body = String(req.body.body || '').trim();
  const head = HEADS.includes(req.body.head) ? req.body.head : HEADS[0];
  const form = { title, body, head, nickname: req.body.nickname };
  const fail = (error) => {
    removeFiles(req.uploaded);
    res.status(400).render('gallery/write', { title: '글쓰기 - ' + g.name, g, heads: HEADS, error, form });
  };

  if (!title || title.length > 80) return fail('제목은 1~80자로 입력해 주세요.');
  if (!body && req.uploaded.length === 0) return fail('내용을 입력하거나 이미지를 올려 주세요.');
  if (body.length > 20000) return fail('내용이 너무 길어요. (최대 20,000자)');
  const a = authorFields(req);
  if (a.error) return fail(a.error);
  const wait = cooldown('gpost:' + (req.user ? 'u' + req.user.id : req.ip), req.user ? 5000 : 15000);
  if (wait) return fail(`도배 방지를 위해 ${wait}초 후에 다시 써 주세요.`);

  const r = db
    .prepare(
      `INSERT INTO gposts (gallery_id, user_id, nickname, password_hash, ip_prefix, head, title, body, images, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(g.id, a.user_id, a.nickname, a.password_hash, a.ip_prefix, head, title, body, JSON.stringify(req.uploaded), Date.now());
  res.redirect(`/g/${g.slug}/${r.lastInsertRowid}`);
});

// ===== 글 보기 =====
router.get('/:slug/:id', (req, res) => {
  const g = getGallery(req.params.slug);
  if (!g) return notFound(res, '존재하지 않는 갤러리예요.');
  const post = getPost(g, req.params.id);
  if (!post) return notFound(res, '삭제되었거나 존재하지 않는 글이에요.');

  db.prepare('UPDATE gposts SET views = views + 1 WHERE id = ?').run(post.id);
  post.views += 1;
  const comments = db
    .prepare(
      `SELECT c.*, u.username, u.display_name FROM gcomments c LEFT JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ? ORDER BY c.id`
    )
    .all(post.id);
  const myVote = db.prepare('SELECT dir FROM gvotes WHERE post_id = ? AND voter = ?').get(post.id, voterKey(req));
  const prev = db.prepare('SELECT id, title FROM gposts WHERE gallery_id = ? AND id < ? ORDER BY id DESC LIMIT 1').get(g.id, post.id);
  const nextPost = db.prepare('SELECT id, title FROM gposts WHERE gallery_id = ? AND id > ? ORDER BY id ASC LIMIT 1').get(g.id, post.id);

  res.render('gallery/view', {
    title: post.title + ' - ' + g.name,
    g, post, comments, prev, next: nextPost,
    imgs: images(post.images),
    myVote: myVote ? myVote.dir : 0,
    concept: post.up >= CONCEPT_THRESHOLD,
    msg: req.query.msg || '',
  });
});

// ===== 추천 / 비추천 =====
router.post('/:slug/:id/vote', (req, res) => {
  const g = getGallery(req.params.slug);
  const post = g && getPost(g, req.params.id);
  if (!post) return notFound(res);
  const dir = req.body.dir === 'down' ? -1 : 1;
  const r = db.prepare('INSERT OR IGNORE INTO gvotes (post_id, voter, dir, created_at) VALUES (?, ?, ?, ?)').run(post.id, voterKey(req), dir, Date.now());
  let msg = '';
  if (r.changes) db.prepare(`UPDATE gposts SET ${dir === 1 ? 'up = up + 1' : 'down = down + 1'} WHERE id = ?`).run(post.id);
  else msg = 'voted';
  res.redirect(`/g/${g.slug}/${post.id}${msg ? '?msg=' + msg : ''}#vote`);
});

// ===== 댓글 =====
router.post('/:slug/:id/comment', (req, res) => {
  const g = getGallery(req.params.slug);
  const post = g && getPost(g, req.params.id);
  if (!post) return notFound(res);
  const body = String(req.body.body || '').trim();
  const back = (msg) => res.redirect(`/g/${g.slug}/${post.id}${msg ? '?msg=' + msg : ''}#comments`);
  if (!body || body.length > 1000) return back('comment_len');
  const a = authorFields(req);
  if (a.error) return back('comment_pw');
  if (cooldown('gcomment:' + (req.user ? 'u' + req.user.id : req.ip), 3000)) return back('slow');
  db.prepare(
    'INSERT INTO gcomments (post_id, user_id, nickname, password_hash, ip_prefix, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(post.id, a.user_id, a.nickname, a.password_hash, a.ip_prefix, body, Date.now());
  back();
});

router.post('/:slug/:id/comments/:cid/delete', (req, res) => {
  const g = getGallery(req.params.slug);
  const post = g && getPost(g, req.params.id);
  if (!post) return notFound(res);
  const c = db.prepare('SELECT * FROM gcomments WHERE id = ? AND post_id = ?').get(toInt(req.params.cid) || 0, post.id);
  if (!c) return res.redirect(`/g/${g.slug}/${post.id}#comments`);
  if (!canManage(req, c, req.body.password)) return res.redirect(`/g/${g.slug}/${post.id}?msg=bad_pw#comments`);
  db.prepare('DELETE FROM gcomments WHERE id = ?').run(c.id);
  res.redirect(`/g/${g.slug}/${post.id}#comments`);
});

// ===== 글 삭제 =====
router.post('/:slug/:id/delete', (req, res) => {
  const g = getGallery(req.params.slug);
  const post = g && getPost(g, req.params.id);
  if (!post) return notFound(res);
  if (!canManage(req, post, req.body.password)) return res.redirect(`/g/${g.slug}/${post.id}?msg=bad_pw`);
  db.prepare('DELETE FROM gposts WHERE id = ?').run(post.id);
  removeFiles(images(post.images));
  res.redirect('/g/' + g.slug);
});

module.exports = router;
