const pad = (n) => String(n).padStart(2, '0');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function nl2br(s) {
  return esc(s).replace(/\r?\n/g, '<br>');
}

// 글 본문: 링크, #태그, @멘션을 클릭할 수 있게 (먼저 HTML 이스케이프)
function richText(s) {
  return esc(s)
    .replace(/https?:\/\/[^\s<>"']+[^\s<>"'.,!?)\]]/g, (url) => {
      const shown = url.replace(/^https?:\/\//, '');
      return `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow ugc">${shown.length > 40 ? shown.slice(0, 40) + '…' : shown}</a>`;
    })
    .replace(/(^|\s)@([a-zA-Z0-9_.]{3,20})/g, '$1<a href="/@$2">@$2</a>')
    .replace(/(^|\s)#([^\s#<>&]{1,30})/g, (m, sp, tag) => `${sp}<a href="/search?q=${encodeURIComponent('#' + tag)}">#${tag}</a>`)
    .replace(/\r?\n/g, '<br>');
}

// 짧은 시간 표시: 오늘이면 HH:MM, 아니면 MM.DD
function shortTime(ts) {
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

// 프로필 사진 대신 닉네임 첫 글자 + 아이디로 정해지는 색
function avatar(u, size = 36) {
  const name = (u && (u.display_name || u.username)) || '?';
  const letter = esc(Array.from(name.trim())[0] || '?').toUpperCase();
  let h = 0;
  for (const ch of String((u && u.username) || name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return `<span class="av av-${size} c${h % 8}" aria-hidden="true">${letter}</span>`;
}

function num(n) {
  n = Number(n) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
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

// 선 아이콘 (SVG). CSP 때문에 style 속성 없이 currentColor만 사용
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  heart: '<path d="M12 20s-7.5-4.6-9.2-9.3C1.6 7.3 3.8 4 7.2 4c2 0 3.6 1.1 4.8 2.8C13.2 5.1 14.8 4 16.8 4c3.4 0 5.6 3.3 4.4 6.7C19.5 15.4 12 20 12 20z"/>',
  reply: '<path d="M20.5 12a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.2-4.3A8.5 8.5 0 1 1 20.5 12z"/>',
  repost: '<path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 11V9.5A3.5 3.5 0 0 1 7 6h13.5"/><path d="M7 21.5 3.5 18 7 14.5"/><path d="M20.5 13v1.5A3.5 3.5 0 0 1 17 18H3.5"/>',
  share: '<path d="m21 3-9.5 9.5"/><path d="M21 3 14.5 21l-3-8.5L3 9.5z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6 8.5 7 8.5-7"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6z"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  quote: '<path d="M4 7h16M4 12h10M4 17h7"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};
function icon(name, size = 22, cls = '') {
  return `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

const cooldowns = new Map();
function cooldown(key, ms) {
  const now = Date.now();
  const until = cooldowns.get(key) || 0;
  if (until > now) return Math.ceil((until - now) / 1000);
  cooldowns.set(key, now + ms);
  if (cooldowns.size > 10000) for (const [k, t] of cooldowns) if (t < now) cooldowns.delete(k);
  return 0;
}

module.exports = { esc, nl2br, richText, shortTime, fullTime, ago, avatar, icon, num, qs, likeEscape, toInt, cooldown };
