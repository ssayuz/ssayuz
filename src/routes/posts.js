// Snippet: 피드, 글쓰기(이어 쓰기), 답글, 좋아요, 리포스트, 인용, 검색
const express = require('express');
const db = require('../db');
const { requireLogin } = require('../auth');
const { toInt, cooldown, likeEscape } = require('../helpers');
const { visible, isAdmin } = require('../moderation');
const { notify, unnotify, notifyMentions } = require('../notify');
const { POST_MAX, THREAD_MAX_PARTS, FEED_PAGE_SIZE } = require('../config');

const router = express.Router();
const POLICIES = ['all', 'following', 'mentioned'];
const wantsJson = (req) => req.get('x-csrf-token') !== undefined;
const viewer = (req) => (req.user ? req.user.id : 0);
const notFound = (res, message = 'Snippet을 찾을 수 없어요.') => res.status(404).render('error', { title: '404', message });

// ---------- 글 불러오기 ----------
function selectPosts(req, where, args = [], tail = '') {
  const v = viewer(req);
  const banned = isAdmin(req) ? '' : ' AND u.banned_at IS NULL';
  return db
    .prepare(
      `SELECT p.*, u.username, u.display_name,
        (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS likes,
        (SELECT COUNT(*) FROM posts r WHERE r.parent_id = p.id AND r.deleted_at IS NULL AND r.hidden_at IS NULL) AS replies,
        (SELECT COUNT(*) FROM reposts rp WHERE rp.post_id = p.id) AS reposts,
        EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked,
        EXISTS (SELECT 1 FROM reposts rp WHERE rp.post_id = p.id AND rp.user_id = ?) AS reposted
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE ${visible(req, 'p')}${banned} AND (${where}) ${tail}`
    )
    .all(v, v, ...args);
}

function getPost(req, id) {
  const pid = toInt(id);
  if (!pid) return null;
  return selectPosts(req, 'p.id = ?', [pid])[0] || null;
}

// 인용한 글, 답글 대상 등을 붙여 줌
function hydrate(req, posts) {
  for (const p of posts) {
    if (p.quote_id) {
      const q = getPost(req, p.quote_id);
      p.quoted = q && !q.deleted_at ? q : { missing: true };
    }
    if (p.parent_id) {
      const parent = db.prepare('SELECT u.username FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?').get(p.parent_id);
      p.parent_username = parent ? parent.username : null;
    }
  }
  return posts;
}

// 답글을 달 수 있는지 (작성자가 정한 범위)
function canReply(user, post) {
  if (!user) return false;
  if (post.deleted_at) return false;
  if (user.id === post.user_id || post.reply_policy === 'all') return true;
  if (post.reply_policy === 'following') {
    return !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(post.user_id, user.id);
  }
  if (post.reply_policy === 'mentioned') {
    return new RegExp(`(^|\\s)@${user.username.replace(/\./g, '\\.')}(?![a-zA-Z0-9_.])`, 'i').test(post.body);
  }
  return false;
}

const postLink = (username, id) => `/@${username}/post/${id}`;

// ---------- 홈 피드 ----------
router.get('/', (req, res) => {
  const tab = req.query.feed === 'following' && req.user ? 'following' : 'foryou';
  const page = toInt(req.query.page) || 1;
  let items = [];

  if (tab === 'foryou') {
    // 최근 2주 글을 반응과 최신순으로 점수 매기기
    const now = Date.now();
    const pool = selectPosts(req, 'p.parent_id IS NULL AND p.deleted_at IS NULL AND p.created_at > ?', [now - 14 * 86400000], 'ORDER BY p.id DESC LIMIT 400');
    for (const p of pool) {
      const hours = (now - p.created_at) / 3600000;
      p.score = (1 + p.likes * 2 + p.replies * 3 + p.reposts * 3) / Math.pow(hours + 2, 1.4);
    }
    pool.sort((a, b) => b.score - a.score);
    items = pool.map((p) => ({ post: p, at: p.created_at }));
    if (items.length < page * FEED_PAGE_SIZE) {
      // 오래된 글도 이어서 보여 주기
      const older = selectPosts(req, 'p.parent_id IS NULL AND p.deleted_at IS NULL AND p.created_at <= ?', [now - 14 * 86400000], 'ORDER BY p.id DESC LIMIT 200');
      items.push(...older.map((p) => ({ post: p, at: p.created_at })));
    }
  } else {
    const uid = req.user.id;
    const posts = selectPosts(
      req,
      'p.parent_id IS NULL AND p.deleted_at IS NULL AND (p.user_id = ? OR p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?))',
      [uid, uid],
      'ORDER BY p.id DESC LIMIT 300'
    );
    items = posts.map((p) => ({ post: p, at: p.created_at }));
    const reps = db
      .prepare(
        `SELECT rp.post_id, rp.created_at, u.username FROM reposts rp JOIN users u ON u.id = rp.user_id
         WHERE rp.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?) ORDER BY rp.created_at DESC LIMIT 200`
      )
      .all(uid);
    for (const r of reps) {
      const p = getPost(req, r.post_id);
      if (p && !p.deleted_at) items.push({ post: p, at: r.created_at, repostedBy: r.username });
    }
    items.sort((a, b) => b.at - a.at);
    // 같은 글이 여러 번 나오지 않게
    const seen = new Set();
    items = items.filter((it) => !seen.has(it.post.id) && seen.add(it.post.id));
  }

  const slice = items.slice((page - 1) * FEED_PAGE_SIZE, page * FEED_PAGE_SIZE);
  hydrate(req, slice.map((it) => it.post));
  const suggestions = req.user
    ? db
        .prepare(
          `SELECT u.username, u.display_name, (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers
           FROM users u WHERE u.id != ? AND u.banned_at IS NULL
             AND u.id NOT IN (SELECT followee_id FROM follows WHERE follower_id = ?)
           ORDER BY followers DESC, u.id DESC LIMIT 5`
        )
        .all(req.user.id, req.user.id)
    : [];
  res.render('home', {
    title: null,
    tab,
    items: slice,
    page,
    hasMore: items.length > page * FEED_PAGE_SIZE,
    suggestions,
    POST_MAX,
  });
});

// ---------- 글쓰기 화면 (답글 / 인용) ----------
router.get('/compose', requireLogin, (req, res) => {
  const parent = req.query.reply ? getPost(req, req.query.reply) : null;
  const quote = req.query.quote ? getPost(req, req.query.quote) : null;
  if (req.query.reply && (!parent || parent.deleted_at)) return notFound(res);
  if (req.query.quote && (!quote || quote.deleted_at)) return notFound(res);
  if (parent && !canReply(req.user, parent)) {
    return res.status(403).render('error', { title: '답글 제한', message: '작성자가 답글을 달 수 있는 사람을 제한했어요.' });
  }
  res.render('compose', { title: parent ? '답글 쓰기' : quote ? '인용하기' : '새 Snippet', parent, quote, error: null, parts: [''], policy: 'all', POST_MAX, THREAD_MAX_PARTS });
});

// ---------- 글 올리기 (여러 개 이어 쓰기 가능) ----------
router.post('/compose', requireLogin, (req, res) => {
  const raw = [].concat(req.body.body ?? []);
  const parts = raw.map((s) => String(s).replace(/\r\n/g, '\n').trim()).filter(Boolean);
  const policy = POLICIES.includes(req.body.reply_policy) ? req.body.reply_policy : 'all';
  const parent = req.body.parent_id ? getPost(req, req.body.parent_id) : null;
  const quote = req.body.quote_id ? getPost(req, req.body.quote_id) : null;
  const back = String(req.body.back || '');

  const fail = (error, code = 400) =>
    res.status(code).render('compose', {
      title: '새 Snippet', parent, quote, error, parts: raw.length ? raw.map(String) : [''], policy, POST_MAX, THREAD_MAX_PARTS,
    });

  if (req.body.parent_id && (!parent || parent.deleted_at)) return notFound(res);
  if (req.body.quote_id && (!quote || quote.deleted_at)) return notFound(res);
  if (!parts.length) return fail('내용을 입력해 주세요.');
  if (parts.length > THREAD_MAX_PARTS) return fail(`한 번에 ${THREAD_MAX_PARTS}개까지 이어 쓸 수 있어요.`);
  if (parts.some((p) => Array.from(p).length > POST_MAX)) return fail(`글 하나는 ${POST_MAX}자까지 쓸 수 있어요.`);
  if (parent && !canReply(req.user, parent)) return fail('작성자가 답글을 달 수 있는 사람을 제한했어요.', 403);
  const wait = cooldown('post:' + req.user.id, 3000);
  if (wait) return fail(`조금만 천천히! ${wait}초 뒤에 다시 올려 주세요.`, 429);

  const now = Date.now();
  const insert = db.prepare(
    'INSERT INTO posts (user_id, parent_id, root_id, quote_id, body, reply_policy, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const ids = [];
  db.exec('BEGIN');
  try {
    let parentId = parent ? parent.id : null;
    let rootId = parent ? parent.root_id || parent.id : null;
    parts.forEach((body, i) => {
      const r = insert.run(req.user.id, parentId, rootId, i === 0 && quote ? quote.id : null, body, policy, now + i);
      const id = Number(r.lastInsertRowid);
      ids.push(id);
      if (!rootId) rootId = id;
      parentId = id;
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  const me = req.user;
  const firstLink = postLink(me.username, ids[0]);
  if (parent) notify({ userId: parent.user_id, actor: me, type: 'reply', link: firstLink, snippet: parts[0] });
  if (quote) notify({ userId: quote.user_id, actor: me, type: 'quote', link: firstLink, snippet: parts[0] });
  parts.forEach((body, i) =>
    notifyMentions(body, me, postLink(me.username, ids[i]), [parent && parent.user_id, quote && quote.user_id].filter(Boolean))
  );

  if (parent) {
    const target = back.startsWith('/') && !back.startsWith('//') ? back : postLink(parent.username, parent.id);
    return res.redirect(target.split('#')[0] + '#post-' + ids[0]);
  }
  res.redirect(firstLink);
});

// ---------- 글 보기 (대화 전체) ----------
router.get('/@:username/post/:id', (req, res) => {
  const post = getPost(req, req.params.id);
  if (!post) return notFound(res);
  if (post.username.toLowerCase() !== String(req.params.username).toLowerCase()) {
    return res.redirect(301, postLink(post.username, post.id));
  }
  // 위쪽 대화 (원글들)
  const ancestors = [];
  let cur = post;
  for (let i = 0; i < 30 && cur.parent_id; i++) {
    const up = getPost(req, cur.parent_id);
    if (!up) { ancestors.unshift({ missing: true }); break; }
    ancestors.unshift(up);
    cur = up;
  }
  // 바로 아래 답글: 작성자의 이어 쓰기 먼저, 그다음 좋아요 많은 순
  const replies = selectPosts(req, 'p.parent_id = ? AND p.deleted_at IS NULL', [post.id], 'ORDER BY p.created_at');
  replies.sort((a, b) => (b.user_id === post.user_id) - (a.user_id === post.user_id) || b.likes - a.likes || a.created_at - b.created_at);
  hydrate(req, [post, ...ancestors.filter((a) => !a.missing), ...replies]);
  res.render('post', {
    title: `${post.display_name}: ${post.deleted_at ? '삭제된 Snippet' : post.body.slice(0, 40)}`,
    post, ancestors, replies,
    canReply: canReply(req.user, post),
    POST_MAX,
  });
});

// ---------- 좋아요 / 리포스트 (토글) ----------
function toggle(table, type) {
  return (req, res) => {
    const post = getPost(req, req.params.id);
    if (!post || post.deleted_at) return wantsJson(req) ? res.status(404).json({ error: 'not_found' }) : notFound(res);
    const me = req.user;
    const link = postLink(post.username, post.id);
    const exists = db.prepare(`SELECT 1 FROM ${table} WHERE post_id = ? AND user_id = ?`).get(post.id, me.id);
    if (exists) {
      db.prepare(`DELETE FROM ${table} WHERE post_id = ? AND user_id = ?`).run(post.id, me.id);
      unnotify({ userId: post.user_id, actorId: me.id, type, link });
    } else {
      db.prepare(`INSERT INTO ${table} (post_id, user_id, created_at) VALUES (?, ?, ?)`).run(post.id, me.id, Date.now());
      notify({ userId: post.user_id, actor: me, type, link, snippet: post.body });
    }
    const count = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE post_id = ?`).get(post.id).n;
    if (wantsJson(req)) return res.json({ on: !exists, count });
    const back = String((req.body && req.body.back) || '');
    res.redirect(back.startsWith('/') && !back.startsWith('//') ? back : link);
  };
}
router.post('/post/:id/like', requireLogin, toggle('post_likes', 'like'));
router.post('/post/:id/repost', requireLogin, toggle('reposts', 'repost'));

// ---------- 삭제 ----------
router.post('/post/:id/delete', requireLogin, (req, res) => {
  const post = getPost(req, req.params.id);
  if (!post) return notFound(res);
  if (post.user_id !== req.user.id) return res.status(403).render('error', { title: '403', message: '내 Snippet만 삭제할 수 있어요.' });
  const hasReplies = db.prepare('SELECT 1 FROM posts WHERE parent_id = ?').get(post.id);
  if (hasReplies) {
    // 답글이 달린 글은 대화가 끊기지 않게 자리만 남김
    db.prepare("UPDATE posts SET deleted_at = ?, body = '' WHERE id = ?").run(Date.now(), post.id);
  } else {
    db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  }
  db.prepare('DELETE FROM notifications WHERE link = ?').run(postLink(post.username, post.id));
  res.redirect(post.parent_id ? `/post/${post.parent_id}` : '/@' + req.user.username);
});

// 아이디 없이 글 번호로 들어와도 제자리로
router.get('/post/:id', (req, res) => {
  const post = getPost(req, req.params.id);
  if (!post) return notFound(res);
  res.redirect(postLink(post.username, post.id));
});

// ---------- 검색 ----------
router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 50);
  let people = [];
  let posts = [];
  if (q) {
    const like = '%' + likeEscape(q.replace(/^@/, '')) + '%';
    if (!q.startsWith('#')) {
      people = db
        .prepare(
          `SELECT username, display_name, bio, (SELECT COUNT(*) FROM follows f WHERE f.followee_id = users.id) AS followers
           FROM users WHERE banned_at IS NULL AND (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')
           ORDER BY followers DESC LIMIT 10`
        )
        .all(like, like);
    }
    const textLike = q.startsWith('#') ? '%' + likeEscape(q) + '%' : '%' + likeEscape(q) + '%';
    posts = hydrate(req, selectPosts(req, "p.deleted_at IS NULL AND p.body LIKE ? ESCAPE '\\'", [textLike], 'ORDER BY p.id DESC LIMIT 40'));
  } else {
    people = db
      .prepare(
        `SELECT username, display_name, bio, (SELECT COUNT(*) FROM follows f WHERE f.followee_id = users.id) AS followers
         FROM users WHERE banned_at IS NULL ${req.user ? 'AND id != ?' : ''} ORDER BY followers DESC, id DESC LIMIT 15`
      )
      .all(...(req.user ? [req.user.id] : []));
  }
  res.render('search', { title: q ? `'${q}' 검색` : '검색', q, people, posts });
});

module.exports = router;
module.exports.selectPosts = selectPosts;
module.exports.hydrate = hydrate;
module.exports.postLink = postLink;
