const express = require('express');
const db = require('../db');
const { hashPassword, verifyPassword, createSession, destroySession, safeNext } = require('../auth');

const router = express.Router();
const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;

router.get('/signup', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('signup', { title: '가입하기', error: null, form: {} });
});

router.post('/signup', (req, res) => {
  const username = String(req.body.username || '').trim();
  const displayName = String(req.body.display_name || '').trim();
  const password = String(req.body.password || '');
  const form = { username, display_name: displayName };
  const fail = (error) => res.status(400).render('signup', { title: '가입하기', error, form });

  if (!USERNAME_RE.test(username)) return fail('아이디는 영문, 숫자, _ . 로 3~20자여야 해요.');
  if (!displayName || displayName.length > 20) return fail('닉네임은 1~20자로 입력해 주세요.');
  if (password.length < 6 || password.length > 200) return fail('비밀번호는 6자 이상이어야 해요.');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return fail('이미 사용 중인 아이디예요.');

  const r = db
    .prepare('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(username, displayName, hashPassword(password), Date.now());
  createSession(res, Number(r.lastInsertRowid));
  res.redirect('/feed');
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: '로그인', error: null, next: safeNext(req.query.next), username: '' });
});

router.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const next = safeNext(req.body.next);
  const u = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(username);
  if (!u || !verifyPassword(password, u.password_hash)) {
    return res.status(400).render('login', { title: '로그인', error: '아이디 또는 비밀번호가 맞지 않아요.', next, username });
  }
  createSession(res, u.id);
  res.redirect(next);
});

router.post('/logout', (req, res) => {
  destroySession(req, res);
  res.redirect('/');
});

module.exports = router;
