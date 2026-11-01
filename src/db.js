const path = require('path');
const crypto = require('crypto');
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
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

-- ===== Snippet (글) =====
-- parent_id: 답글이면 원글, root_id: 대화의 맨 첫 글, quote_id: 인용한 글
-- reply_policy: all | following(작성자가 팔로우한 사람) | mentioned(글에서 언급한 사람)
CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id    INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  root_id      INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  quote_id     INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  body         TEXT NOT NULL,
  reply_policy TEXT NOT NULL DEFAULT 'all',
  created_at   INTEGER NOT NULL,
  deleted_at   INTEGER,
  hidden_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_parent ON posts(parent_id, id);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS reposts (
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_reposts_user ON reposts(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);

-- ===== 활동(알림) =====
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
  actor_name TEXT NOT NULL,
  type       TEXT NOT NULL,
  link       TEXT NOT NULL,
  snippet    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  read_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id DESC);

-- ===== DM =====
CREATE TABLE IF NOT EXISTS dm_threads (
  id      INTEGER PRIMARY KEY,
  user_a  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_at INTEGER NOT NULL,
  UNIQUE (user_a, user_b)
);
CREATE TABLE IF NOT EXISTS dm_messages (
  id         INTEGER PRIMARY KEY,
  thread_id  INTEGER NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
  sender_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_dm_messages_thread ON dm_messages(thread_id, id);

-- ===== 관리 =====
CREATE TABLE IF NOT EXISTS admin_log (
  id         INTEGER PRIMARY KEY,
  admin_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  target     TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// 기존 DB에 새 열 추가 (마이그레이션)
function addColumn(table, column, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}
addColumn('users', 'role', "TEXT NOT NULL DEFAULT 'user'");
addColumn('users', 'banned_at', 'INTEGER');
addColumn('users', 'ban_reason', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'link', "TEXT NOT NULL DEFAULT ''");

if (!db.prepare("SELECT 1 FROM settings WHERE key = 'ip_salt'").get()) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('ip_salt', ?)").run(crypto.randomBytes(16).toString('hex'));
}

// ADMIN_USERNAMES=alice,bob 이면 관리자로 지정
const admins = String(process.env.ADMIN_USERNAMES || '').split(',').map((s) => s.trim()).filter(Boolean);
for (const name of admins) db.prepare("UPDATE users SET role = 'admin' WHERE username = ?").run(name);

module.exports = db;
