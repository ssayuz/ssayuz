// 프로필, 팔로우, 프로필 편집
const express = require('express');
const db = require('../db');
const { requireLogin } = require('../auth');
const { isAdmin } = require('../moderation');
const { notify } = require('../notify');
const { selectPosts, hydrate } = require('./posts');

const router = express.Router();
const wantsJson = (req) => req.get('x-csrf-token') !== undefined;
const notFound = (res) => res.status(404).render('error', { title: '404', message: '없는 사람이에요.' });

function getMember(username) {
  return db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.bio, u.link, u.created_at, u.role, u.banned_at, u.ban_reason,
        (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers,
        (SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.id) AS following
       FROM users u WHERE u.username = ?`
    )
    .get(String(username));
}

router.get('/@:username', (req, res) => {
  const member = getMember(req.params.username);
  if (!member) return notFound(res);
  const tab = ['replies', 'reposts'].includes(req.query.tab) ? req.query.tab : 'threads';
  const isMe = !!req.user && req.user.id === member.id;
  const following = req.user && !isMe
    ? !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(req.user.id, member.id)
    : false;
  const followsMe = req.user && !isMe
    ? !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(member.id, req.user.id)
    : false;

  let posts = [];
  if (!member.banned_at || isAdmin(req)) {
    if (tab === 'threads') {
      posts = selectPosts(req, 'p.user_id = ? AND p.parent_id IS NULL AND p.deleted_at IS NULL', [member.id], 'ORDER BY p.id DESC LIMIT 60');
    } else if (tab === 'replies') {
      posts = selectPosts(req, 'p.user_id = ? AND p.parent_id IS NOT NULL AND p.deleted_at IS NULL', [member.id], 'ORDER BY p.id DESC LIMIT 60');
    } else {
      posts = selectPosts(
        req,
        'p.deleted_at IS NULL AND p.id IN (SELECT post_id FROM reposts WHERE user_id = ?)',
        [member.id],
        `ORDER BY (SELECT created_at FROM reposts WHERE user_id = ${Number(member.id)} AND post_id = p.id) DESC LIMIT 60`
      );
    }
    hydrate(req, posts);
  }
  res.render('profile', { title: `${member.display_name} (@${member.username})`, member, tab, isMe, following, followsMe, posts });
});

router.get('/@:username/:list', (req, res, next) => {
  const list = req.params.list;
  if (list !== 'followers' && list !== 'following') return next();
  const member = getMember(req.params.username);
  if (!member) return notFound(res);
  const people = db
    .prepare(
      list === 'followers'
        ? `SELECT u.username, u.display_name, u.bio FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followee_id = ? ORDER BY f.created_at DESC`
        : `SELECT u.username, u.display_name, u.bio FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ? ORDER BY f.created_at DESC`
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
    else {
      db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)').run(req.user.id, member.id, Date.now());
      notify({ userId: member.id, actor: req.user, type: 'follow', link: '/@' + req.user.username });
    }
    if (wantsJson(req)) {
      const followers = db.prepare('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?').get(member.id).n;
      return res.json({ following: !exists, followers });
    }
  }
  const back = String((req.body && req.body.back) || '');
  res.redirect(back.startsWith('/') && !back.startsWith('//') ? back : '/@' + member.username);
});

// ---------- 프로필 편집 ----------
router.get('/settings', requireLogin, (req, res) => {
  const me = db.prepare('SELECT display_name, bio, link FROM users WHERE id = ?').get(req.user.id);
  res.render('settings', { title: '프로필 편집', error: null, saved: req.query.saved === '1', form: me });
});

router.post('/settings', requireLogin, (req, res) => {
  const form = {
    display_name: String(req.body.display_name || '').trim(),
    bio: String(req.body.bio || '').trim(),
    link: String(req.body.link || '').trim(),
  };
  const fail = (error) => res.status(400).render('settings', { title: '프로필 편집', error, saved: false, form });
  if (!form.display_name || form.display_name.length > 20) return fail('이름은 1~20자로 해 주세요.');
  if (form.bio.length > 150) return fail('소개는 150자 이하로 써 주세요.');
  if (form.link) {
    if (!/^https?:\/\//i.test(form.link)) form.link = 'https://' + form.link;
    try {
      const u = new URL(form.link);
      if (!['http:', 'https:'].includes(u.protocol) || form.link.length > 200) throw new Error();
    } catch {
      return fail('링크 주소가 올바르지 않아요.');
    }
  }
  db.prepare('UPDATE users SET display_name = ?, bio = ?, link = ? WHERE id = ?').run(form.display_name, form.bio, form.link, req.user.id);
  res.redirect('/settings?saved=1');
});

module.exports = router;
