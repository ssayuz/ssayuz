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

-- ===== 토크: 방(rooms) / 글(talks) / 댓글 / 화력(🔥🧊) =====
CREATE TABLE IF NOT EXISTS rooms (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  emoji       TEXT NOT NULL DEFAULT '💬',
  is_user     INTEGER NOT NULL DEFAULT 0,
  owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS talks (
  id            INTEGER PRIMARY KEY,
  room_id       INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  nickname      TEXT NOT NULL,
  password_hash TEXT,
  ip_prefix     TEXT,
  topic         TEXT NOT NULL DEFAULT '잡담',
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  images        TEXT NOT NULL DEFAULT '[]',
  views         INTEGER NOT NULL DEFAULT 0,
  fire          INTEGER NOT NULL DEFAULT 0,
  ice           INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_talks_room ON talks(room_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_talks_user ON talks(user_id, id DESC);

CREATE TABLE IF NOT EXISTS talk_comments (
  id            INTEGER PRIMARY KEY,
  talk_id       INTEGER NOT NULL REFERENCES talks(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  nickname      TEXT NOT NULL,
  password_hash TEXT,
  ip_prefix     TEXT,
  body          TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_talk_comments ON talk_comments(talk_id, id);

CREATE TABLE IF NOT EXISTS talk_votes (
  talk_id    INTEGER NOT NULL REFERENCES talks(id) ON DELETE CASCADE,
  voter      TEXT NOT NULL,
  dir        INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (talk_id, voter)
);

-- ===== 스냅: 사진(snaps) / 좋아요(likes) / 댓글(comments) / 팔로우(follows) =====
CREATE TABLE IF NOT EXISTS snaps (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  caption    TEXT NOT NULL DEFAULT '',
  images     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snaps_user ON snaps(user_id, id DESC);

CREATE TABLE IF NOT EXISTS likes (
  snap_id    INTEGER NOT NULL REFERENCES snaps(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (snap_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY,
  snap_id    INTEGER NOT NULL REFERENCES snaps(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_snap ON comments(snap_id, id);

CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);

-- ===== 스토리 (24시간 뒤 사라짐) =====
CREATE TABLE IF NOT EXISTS stories (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image      TEXT NOT NULL,
  caption    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stories_user ON stories(user_id, created_at);

CREATE TABLE IF NOT EXISTS story_views (
  story_id   INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (story_id, user_id)
);

-- ===== 알림 =====
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
CREATE TABLE IF NOT EXISTS ip_bans (
  id         INTEGER PRIMARY KEY,
  ip_hash    TEXT NOT NULL UNIQUE,
  ip_prefix  TEXT,
  reason     TEXT NOT NULL DEFAULT '',
  admin_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
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
addColumn('talks', 'ip_hash', 'TEXT');
addColumn('talk_comments', 'ip_hash', 'TEXT');
for (const t of ['talks', 'talk_comments', 'snaps', 'comments']) addColumn(t, 'hidden_at', 'INTEGER');

// 손님 IP 차단용 해시 소금 (DB에 한 번 만들어 둠)
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'ip_salt'").get()) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('ip_salt', ?)").run(require('crypto').randomBytes(16).toString('hex'));
}

// ADMIN_USERNAMES=alice,bob 이면 관리자로 지정
const admins = String(process.env.ADMIN_USERNAMES || '').split(',').map((s) => s.trim()).filter(Boolean);
for (const name of admins) db.prepare("UPDATE users SET role = 'admin' WHERE username = ?").run(name);

// 기본 공식 방
const defaults = [
  ['free', '아무말', '하고 싶은 말 아무거나', '🗯️'],
  ['lol', '웃음벨', '웃긴 썰과 짤', '🤣'],
  ['game', '겜방', '게임 얘기, 파티 모집', '🎮'],
  ['dev', '개발', '코드와 버그와 커피', '⌨️'],
  ['eat', '먹방', '오늘 뭐 먹지', '🍜'],
  ['pet', '댕냥', '반려동물 자랑', '🐾'],
];
const insertRoom = db.prepare(
  'INSERT OR IGNORE INTO rooms (slug, name, description, emoji, is_user, created_at) VALUES (?, ?, ?, ?, 0, ?)'
);
for (const [slug, name, desc, emoji] of defaults) insertRoom.run(slug, name, desc, emoji, Date.now());

module.exports = db;
