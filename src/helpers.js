const pad = (n) => String(n).padStart(2, '0');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function nl2br(s) {
  return esc(s).replace(/\r?\n/g, '<br>');
}

// 인스타 캡션: #해시태그, @멘션 링크
function richText(s) {
  return esc(s)
    .replace(/(^|\s)@([a-zA-Z0-9_.]{3,20})/g, '$1<a href="/u/$2">@$2</a>')
    .replace(/(^|\s)#([^\s#<>&]{1,30})/g, (m, sp, tag) => `${sp}<a href="/explore?tag=${encodeURIComponent(tag)}">#${tag}</a>`)
    .replace(/\r?\n/g, '<br>');
}

// 디시식 시간: 오늘이면 HH:MM, 아니면 MM.DD
function dcTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.getFullYear() !== now.getFullYear()) return `${String(d.getFullYear()).slice(2)}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
  return `${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

function fullTime(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function ago(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return '방금 전';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
  const d = new Date(ts);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function avatar(u) {
  return u && u.avatar ? '/uploads/' + u.avatar : '/static/avatar.svg';
}

function images(json) {
  try {
    const arr = JSON.parse(json || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function num(n) {
  n = Number(n) || 0;
  if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + '만';
  if (n >= 1000) return n.toLocaleString('ko-KR');
  return String(n);
}

// 유동 IP 앞 두 자리 (디시식)
function ipPrefix(ip = '') {
  ip = String(ip).replace(/^::ffff:/, '');
  if (ip === '::1') return '127.0';
  if (ip.includes('.')) return ip.split('.').slice(0, 2).join('.');
  const parts = ip.split(':').filter(Boolean);
  return parts.slice(0, 2).join(':') || '?';
}

function qs(base, params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, v);
  const s = u.toString();
  return s ? `${base}?${s}` : base;
}

function likeEscape(s) {
  return String(s).replace(/[\\%_]/g, (c) => '\\' + c);
}

function toInt(v) {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// 간단한 메모리 쿨다운 (도배 방지)
const cooldowns = new Map();
function cooldown(key, ms) {
  const now = Date.now();
  const until = cooldowns.get(key) || 0;
  if (until > now) return Math.ceil((until - now) / 1000);
  cooldowns.set(key, now + ms);
  if (cooldowns.size > 10000) for (const [k, t] of cooldowns) if (t < now) cooldowns.delete(k);
  return 0;
}

module.exports = { esc, nl2br, richText, dcTime, fullTime, ago, avatar, images, num, ipPrefix, qs, likeEscape, toInt, cooldown };
