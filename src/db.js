const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR } = require('./config');

const db = new DatabaseSync(path.join(DATA_DIR, 'ssayuz.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  bio           TEXT NOT NULL DEFAULT '',
  avatar        TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

-- ===== 갤러리 (디시 스타일) =====
CREATE TABLE IF NOT EXISTS galleries (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_minor    INTEGER NOT NULL DEFAULT 0,
  owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS gposts (
  id            INTEGER PRIMARY KEY,
  gallery_id    INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  nickname      TEXT NOT NULL,
  password_hash TEXT,
  ip_prefix     TEXT,
  head          TEXT NOT NULL DEFAULT '일반',
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  images        TEXT NOT NULL DEFAULT '[]',
  views         INTEGER NOT NULL DEFAULT 0,
  up            INTEGER NOT NULL DEFAULT 0,
  down          INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gposts_gallery ON gposts(gallery_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_gposts_user ON gposts(user_id, id DESC);

CREATE TABLE IF NOT EXISTS gcomments (
  id            INTEGER PRIMARY KEY,
  post_id       INTEGER NOT NULL REFERENCES gposts(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  nickname      TEXT NOT NULL,
  password_hash TEXT,
  ip_prefix     TEXT,
  body          TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gcomments_post ON gcomments(post_id, id);

CREATE TABLE IF NOT EXISTS gvotes (
  post_id    INTEGER NOT NULL REFERENCES gposts(id) ON DELETE CASCADE,
  voter      TEXT NOT NULL,
  dir        INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, voter)
);

-- ===== 피드 (인스타 스타일) =====
CREATE TABLE IF NOT EXISTS posts (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  caption    TEXT NOT NULL DEFAULT '',
  images     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, id DESC);

CREATE TABLE IF NOT EXISTS likes (
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, id);

CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);
`);

// 기본 갤러리
const defaults = [
  ['free', '자유', '아무 얘기나 자유롭게'],
  ['humor', '유머', '웃긴 짤, 썰 모음'],
  ['game', '게임', '게임 이야기'],
  ['coding', '프로그래밍', '개발자들의 놀이터'],
  ['food', '맛집', '오늘 뭐 먹지'],
  ['pet', '반려동물', '댕냥이 자랑'],
];
const insertGallery = db.prepare(
  'INSERT OR IGNORE INTO galleries (slug, name, description, is_minor, created_at) VALUES (?, ?, ?, 0, ?)'
);
for (const [slug, name, desc] of defaults) insertGallery.run(slug, name, desc, Date.now());

function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = db;
module.exports.tx = tx;
