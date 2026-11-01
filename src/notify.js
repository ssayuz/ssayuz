// 알림 만들기 / 지우기
const db = require('./db');

// type: snap_like | snap_comment | talk_comment | talk_fire | follow | mention
function notify({ userId, actor, actorName, type, link, snippet = '' }) {
  if (!userId) return;
  const actorId = actor ? actor.id : null;
  if (actorId && actorId === userId) return; // 내 행동은 알리지 않음
  const name = actor ? actor.username : actorName || '손님';
  // 같은 사람이 같은 대상에 같은 반응을 반복하면 하나로 합침
  if (actorId && ['snap_like', 'talk_fire', 'follow'].includes(type)) {
    db.prepare('DELETE FROM notifications WHERE user_id = ? AND actor_id = ? AND type = ? AND link = ?').run(userId, actorId, type, link);
  }
  db.prepare(
    'INSERT INTO notifications (user_id, actor_id, actor_name, type, link, snippet, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(userId, actorId, name, type, link, String(snippet).slice(0, 80), Date.now());
}

function unnotify({ userId, actorId, type, link }) {
  db.prepare('DELETE FROM notifications WHERE user_id = ? AND actor_id = ? AND type = ? AND link = ?').run(userId, actorId, type, link);
}

// 글 속 @아이디 멘션 알림
function notifyMentions(text, actor, link, skipUserIds = []) {
  const names = new Set();
  for (const m of String(text).matchAll(/(^|\s)@([a-zA-Z0-9_.]{3,20})/g)) names.add(m[2].toLowerCase());
  for (const name of [...names].slice(0, 10)) {
    const u = db.prepare('SELECT id FROM users WHERE username = ?').get(name);
    if (u && !skipUserIds.includes(u.id)) notify({ userId: u.id, actor, type: 'mention', link, snippet: text });
  }
}

module.exports = { notify, unnotify, notifyMentions };
