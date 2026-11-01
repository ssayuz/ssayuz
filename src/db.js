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

-- ===== 스냅: 사진(snaps) / 반짝(sparkles) / 한마디(says) / 찜(picks) =====
CREATE TABLE IF NOT EXISTS snaps (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  caption    TEXT NOT NULL DEFAULT '',
  images     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snaps_user ON snaps(user_id, id DESC);

CREATE TABLE IF NOT EXISTS sparkles (
  snap_id    INTEGER NOT NULL REFERENCES snaps(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (snap_id, user_id)
);

CREATE TABLE IF NOT EXISTS says (
  id         INTEGER PRIMARY KEY,
  snap_id    INTEGER NOT NULL REFERENCES snaps(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_says_snap ON says(snap_id, id);

-- picker가 picked를 찜함 (picked 입장에서 picker는 '팬')
CREATE TABLE IF NOT EXISTS picks (
  picker_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  picked_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (picker_id, picked_id)
);
CREATE INDEX IF NOT EXISTS idx_picks_picked ON picks(picked_id);
`);

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
