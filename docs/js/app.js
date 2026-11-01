// ssayuz — GitHub Pages(정적 사이트) + Supabase(DB, 로그인)
import { SUPABASE_URL, SUPABASE_ANON_KEY, CONFIGURED, EMAIL_DOMAIN } from './config.js';
import { esc, richText, ago, fullTime, shortTime, num, avatar, icon, cleanQuery, POST_MAX, MAX_PARTS } from './util.js';

const BASE = window.__BASE__ || '/';
const main = document.getElementById('main');
const u = (p) => BASE.replace(/\/$/, '') + p; // 사이트 안 주소
const abs = (p) => location.origin + u(p); // 공유용 전체 주소
const rich = (s) => richText(s, u);

const state = { session: null, me: null, unreadNotes: 0, unreadDms: 0, timers: [] };
let sb = null;

// ---------------------------------------------------------------------
// 작은 도구
// ---------------------------------------------------------------------
const isAdmin = () => !!state.me && state.me.role === 'admin' && !state.me.banned_at;
const emailOf = (username) => `${username.toLowerCase()}@${EMAIL_DOMAIN}`;

// 링크 복사: 클립보드 API(HTTPS) → 안 되면 예전 방식(execCommand)
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* 아래 방식으로 */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

function toast(text) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1800);
}

function errMsg(error) {
  if (!error) return '';
  const m = error.message || String(error);
  if (/Invalid login credentials/i.test(m)) return '아이디 또는 비밀번호가 맞지 않아요.';
  if (/Database error saving new user/i.test(m)) return '이미 사용 중인 아이디예요.';
  if (/already registered/i.test(m)) return '이미 사용 중인 아이디예요.';
  if (/Password should be/i.test(m)) return '비밀번호는 6자 이상이어야 해요.';
  if (/rate limit/i.test(m)) return '잠시 뒤에 다시 시도해 주세요.';
  if (/row-level security|permission denied/i.test(m)) return state.me?.banned_at ? '이용이 제한된 계정이에요.' : '권한이 없어요.';
  if (/Failed to fetch|NetworkError/i.test(m)) return '서버에 연결하지 못했어요. 인터넷을 확인해 주세요.';
  return m;
}

async function q(promise) {
  const { data, error, count } = await promise;
  if (error) throw error;
  return count !== undefined && count !== null && data === null ? count : data;
}

function go(path, replace = false) {
  history[replace ? 'replaceState' : 'pushState'](null, '', u(path));
  render();
}

function needLogin() {
  const here = currentPath() + location.search;
  go('/login?next=' + encodeURIComponent(here), true);
}

function setTitle(t) {
  document.title = t ? `${t} — ssayuz` : 'ssayuz — 짧게 말하고, 길게 이어지는 곳';
}

function every(ms, fn) {
  const id = setInterval(() => { if (!document.hidden) fn(); }, ms);
  state.timers.push(id);
}

// ---------------------------------------------------------------------
// 데이터
// ---------------------------------------------------------------------
async function loadMe() {
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  state.me = null;
  if (state.session) {
    state.me = await q(sb.from('profiles').select('*').eq('id', state.session.user.id).maybeSingle());
  }
}

async function refreshBadges() {
  if (!state.me) { state.unreadNotes = state.unreadDms = 0; return drawNav(); }
  const [n, d] = await Promise.all([
    sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
    sb.from('dm_messages').select('id', { count: 'exact', head: true }).eq('recipient_id', state.me.id).is('read_at', null),
  ]);
  state.unreadNotes = n.count || 0;
  state.unreadDms = d.count || 0;
  drawNav();
}

const POSTS = () => sb.from('post_view').select('*');

// 인용한 글 붙이기
async function hydrate(posts) {
  const ids = [...new Set(posts.filter((p) => p.quote_id).map((p) => p.quote_id))];
  if (ids.length) {
    const quoted = await q(POSTS().in('id', ids));
    const map = new Map(quoted.map((x) => [x.id, x]));
    for (const p of posts) if (p.quote_id) p.quoted = map.get(p.quote_id) && !map.get(p.quote_id).deleted_at ? map.get(p.quote_id) : { missing: true };
  }
  return posts;
}

async function getPost(id) {
  return q(POSTS().eq('id', id).maybeSingle());
}

// ---------------------------------------------------------------------
// 화면 조각
// ---------------------------------------------------------------------
const badge = (n) => (n ? `<span class="badge">${n > 99 ? '99+' : n}</span>` : '');

function drawNav() {
  const path = currentPath();
  const me = state.me;
  const meLink = me ? '/@' + me.username : '/login';
  const items = [
    ['/', 'home', '홈', path === '/'],
    ['/search', 'search', '검색', path.startsWith('/search')],
    ['/compose', 'plus', '새 Snippet', path.startsWith('/compose'), 'nav-plus'],
    ['/activity', 'heart', '활동', path.startsWith('/activity'), '', badge(state.unreadNotes)],
    [meLink, 'user', '프로필', !!me && path.startsWith('/@' + me.username)],
  ];
  const html = (dock) => items.map(([href, ic, label, on, cls = '', extra = '']) =>
    `<a href="${u(href)}" class="${on ? 'on' : ''} ${dock && ic === 'plus' ? 'dock-plus' : cls}" title="${label}">${icon(ic, 26)}${extra}<span class="sr">${label}</span></a>`).join('');
  document.getElementById('mainnav').innerHTML = html(false);
  document.getElementById('dock').innerHTML = html(true);
  document.getElementById('topright').innerHTML = me
    ? `${isAdmin() ? `<a class="iconlink ${path.startsWith('/admin') ? 'on' : ''}" href="${u('/admin')}" title="관리">${icon('shield')}<span class="sr">관리</span></a>` : ''}
       <a class="iconlink ${path.startsWith('/dm') ? 'on' : ''}" href="${u('/dm')}" title="메시지">${icon('mail')}${badge(state.unreadDms)}<span class="sr">메시지</span></a>`
    : `<a class="btn btn-sm" href="${u('/login')}">로그인</a><a class="btn btn-ink btn-sm hide-sm" href="${u('/signup')}">가입</a>`;
}

function pageHead(title, back = true, right = '<span class="icon-btn"></span>') {
  return `<div class="page-head">${back ? `<a class="icon-btn" href="${u('/')}" data-back aria-label="뒤로">${icon('back')}</a>` : '<span class="icon-btn"></span>'}<h1 class="page-title">${title}</h1>${right}</div>`;
}

function quoteHtml(qp) {
  if (qp.missing) return '<div class="quote quote-missing">볼 수 없는 Snippet이에요.</div>';
  return `<a class="quote" href="${u(`/@${qp.username}/post/${qp.id}`)}">
    <span class="quote-head">${avatar(qp, 20)}<b>${esc(qp.display_name)}</b><span class="handle">@${esc(qp.username)}</span><span class="muted">· ${ago(qp.created_at)}</span></span>
    <span class="quote-body">${esc(qp.body)}</span></a>`;
}

function postHtml(p, o = {}) {
  if (p.missing) return `<div class="post post-gone ${o.line ? 'has-line' : ''}"><div class="post-grid"><span class="post-av"><span class="av av-40 av-ghost">?</span></span><div class="post-main muted">볼 수 없는 Snippet이에요.</div></div></div>`;
  if (p.deleted_at) return `<div class="post post-gone ${o.line ? 'has-line' : ''}" id="post-${p.id}"><div class="post-grid"><span class="post-av"><span class="av av-40 av-ghost">×</span></span><div class="post-main muted">작성자가 삭제한 Snippet이에요.</div></div></div>`;
  const link = `/@${p.username}/post/${p.id}`;
  const mine = state.me && state.me.id === p.user_id;
  return `
<article class="post ${o.big ? 'post-big' : ''} ${o.line ? 'has-line' : ''} ${p.hidden_at ? 'is-hidden' : ''}" id="post-${p.id}" data-href="${u(link)}">
  ${o.repostedBy ? `<div class="repost-by">${icon('repost', 15)} @${esc(o.repostedBy)}님이 리포스트함</div>` : ''}
  <div class="post-grid">
    <a class="post-av" href="${u('/@' + p.username)}" tabindex="-1">${avatar(p, 40)}</a>
    <div class="post-main">
      <div class="post-head">
        <a class="name" href="${u('/@' + p.username)}">${esc(p.display_name)}</a>
        <span class="handle">@${esc(p.username)}</span>
        <a class="time" href="${u(link)}" title="${fullTime(p.created_at)}">${ago(p.created_at)}</a>
        ${p.hidden_at ? '<span class="tag tag-hot">숨김</span>' : ''}
        <span class="grow"></span>
        <details class="menu">
          <summary class="icon-btn" aria-label="더 보기">${icon('more', 20)}</summary>
          <div class="menu-pop">
            <button type="button" class="menu-item" data-copy="${abs(link)}">${icon('link', 18)} 링크 복사</button>
            ${mine ? `<button type="button" class="menu-item danger" data-delete="${p.id}">삭제</button>` : ''}
            ${isAdmin() ? `<button type="button" class="menu-item" data-hide="${p.id}" data-hidden="${p.hidden_at ? 1 : 0}">${icon('shield', 18)} ${p.hidden_at ? '숨김 해제' : '숨기기'} (관리자)</button>` : ''}
          </div>
        </details>
      </div>
      ${o.showParent && p.parent_username ? `<div class="reply-to">↳ <a href="${u('/post/' + p.parent_id)}">@${esc(p.parent_username)}</a>님에게 답글</div>` : ''}
      <div class="post-body">${rich(p.body)}</div>
      ${p.quoted ? quoteHtml(p.quoted) : ''}
      ${p.reply_policy !== 'all' && o.big ? `<div class="policy-note">${p.reply_policy === 'following' ? '작성자가 팔로우하는 사람만' : '언급된 사람만'} 답글을 달 수 있어요</div>` : ''}
      <div class="actions">
        <button type="button" class="act like ${p.liked ? 'on' : ''}" data-like="${p.id}" aria-pressed="${p.liked}" aria-label="좋아요">${icon('heart', 20)}<span class="n" data-raw="${p.likes}">${p.likes ? num(p.likes) : ''}</span></button>
        <a class="act" href="${o.big ? '#reply' : u('/compose?reply=' + p.id)}" ${o.big ? 'data-plain' : ''} aria-label="답글">${icon('reply', 20)}<span class="n">${p.replies ? num(p.replies) : ''}</span></a>
        <details class="menu repost-menu">
          <summary class="act ${p.reposted ? 'on-repost' : ''}" aria-label="리포스트">${icon('repost', 20)}<span class="n" data-raw="${p.reposts}">${p.reposts ? num(p.reposts) : ''}</span></summary>
          <div class="menu-pop">
            <button type="button" class="menu-item" data-repost="${p.id}">${icon('repost', 18)} <span class="repost-label">${p.reposted ? '리포스트 취소' : '리포스트'}</span></button>
            <a class="menu-item" href="${u('/compose?quote=' + p.id)}">${icon('quote', 18)} 인용하기</a>
          </div>
        </details>
        <button type="button" class="act" data-copy="${abs(link)}" aria-label="링크 공유">${icon('share', 20)}</button>
      </div>
    </div>
  </div>
</article>`;
}

function composerHtml(c = {}) {
  const me = state.me;
  const part = (i, text = '') => `
    <div class="part">
      <div class="part-av">${avatar(me, 40)}</div>
      <div class="part-main">
        <div class="part-head"><b>${esc(me.display_name)}</b>${i > 0 ? '<button type="button" class="linkbtn tiny part-remove">빼기</button>' : ''}</div>
        <textarea name="body" rows="${c.compact ? 2 : 3}" placeholder="${esc(c.placeholder || (i === 0 ? '무슨 생각 해요?' : '이어서 쓰기...'))}" aria-label="Snippet 내용">${esc(text)}</textarea>
        <div class="part-foot"><span class="count"></span></div>
      </div>
    </div>`;
  return `
<form class="composer ${c.compact ? 'compact' : ''}" id="${c.id || 'composer'}">
  <div class="parts">${part(0)}</div>
  ${c.quote ? `<div class="composer-quote">${quoteHtml(c.quote)}</div>` : ''}
  <div class="composer-bar">
    <button type="button" class="linkbtn add-part">${icon('plus', 16)} 이어서 쓰기</button>
    <span class="grow"></span>
    ${c.parentId ? '' : `<label class="policy"><span class="sr">답글 허용 범위</span>
      <select name="reply_policy">
        <option value="all">누구나 답글</option>
        <option value="following">내가 팔로우하는 사람만</option>
        <option value="mentioned">언급한 사람만</option>
      </select></label>`}
    <button class="btn btn-ink btn-sm post-btn" disabled>${c.parentId ? '답글 달기' : '게시'}</button>
  </div>
</form>`;
}

// 글쓰기 상자 동작 (글자 수, 이어 쓰기, 올리기)
function wireComposer(form, { parentId = null, quoteId = null, onDone }) {
  const parts = form.querySelector('.parts');
  const addBtn = form.querySelector('.add-part');
  const submit = form.querySelector('.post-btn');
  const len = (s) => Array.from(s).length;
  const fit = (ta) => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
  function refresh() {
    let any = false, over = false;
    parts.querySelectorAll('.part').forEach((p) => {
      const ta = p.querySelector('textarea');
      const left = POST_MAX - len(ta.value);
      const cnt = p.querySelector('.count');
      cnt.textContent = left <= 50 ? String(left) : '';
      cnt.classList.toggle('warn', left < 0);
      if (ta.value.trim()) any = true;
      if (left < 0) over = true;
    });
    submit.disabled = !any || over;
    addBtn.hidden = parts.children.length >= MAX_PARTS;
  }
  function wire(p) {
    const ta = p.querySelector('textarea');
    ta.addEventListener('input', () => { fit(ta); refresh(); });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !submit.disabled) { e.preventDefault(); form.requestSubmit(); }
    });
    p.querySelector('.part-remove')?.addEventListener('click', () => { p.remove(); refresh(); });
  }
  wire(parts.querySelector('.part'));
  addBtn.addEventListener('click', () => {
    const p = parts.querySelector('.part').cloneNode(true);
    const ta = p.querySelector('textarea');
    ta.value = '';
    ta.placeholder = '이어서 쓰기...';
    ta.style.height = '';
    const head = p.querySelector('.part-head');
    head.querySelector('.part-remove')?.remove();
    head.insertAdjacentHTML('beforeend', '<button type="button" class="linkbtn tiny part-remove">빼기</button>');
    parts.append(p);
    wire(p);
    refresh();
    ta.focus();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.querySelector('.alert')?.remove();
    const bodies = [...parts.querySelectorAll('textarea')].map((t) => t.value.trim()).filter(Boolean);
    if (!bodies.length) return;
    const policy = form.querySelector('[name=reply_policy]')?.value || 'all';
    submit.disabled = true;
    const ids = [];
    try {
      let parent = parentId;
      for (let i = 0; i < bodies.length; i++) {
        const row = { body: bodies[i], reply_policy: policy };
        if (parent) row.parent_id = parent;
        if (i === 0 && quoteId) row.quote_id = quoteId;
        const created = await q(sb.from('posts').insert(row).select('id').single());
        ids.push(created.id);
        parent = created.id;
      }
      onDone(ids);
    } catch (err) {
      form.querySelector('.composer-bar').insertAdjacentHTML('beforebegin', `<div class="alert">${esc(errMsg(err))}</div>`);
      if (ids.length) onDone(ids);
      refresh();
    }
  });
  refresh();
}

function followBtn(target, following, followsMe, block = false) {
  return `<button type="button" class="btn ${block ? 'btn-block' : 'btn-sm'} ${following ? '' : block ? 'btn-ink' : ''}" data-follow="${target.id}" data-following="${following ? 1 : 0}">${following ? '팔로잉' : followsMe ? '맞팔로우' : '팔로우'}</button>`;
}

// ---------------------------------------------------------------------
// 페이지들
// ---------------------------------------------------------------------
async function viewHome(params) {
  const me = state.me;
  const tab = params.get('feed') === 'following' && me ? 'following' : 'foryou';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const SIZE = 20;
  setTitle(null);
  let items = [];

  if (tab === 'foryou') {
    const pool = await q(POSTS().is('parent_id', null).is('deleted_at', null).order('id', { ascending: false }).limit(400));
    const now = Date.now();
    for (const p of pool) {
      const hours = (now - new Date(p.created_at).getTime()) / 3600000;
      p.score = (1 + p.likes * 2 + p.replies * 3 + p.reposts * 3) / Math.pow(hours + 2, 1.4);
    }
    pool.sort((a, b) => b.score - a.score);
    items = pool.map((p) => ({ post: p, at: p.created_at }));
  } else {
    const fl = await q(sb.from('follows').select('followee_id').eq('follower_id', me.id));
    const ids = fl.map((f) => f.followee_id);
    const posts = await q(POSTS().in('user_id', [...ids, me.id]).is('parent_id', null).is('deleted_at', null).order('id', { ascending: false }).limit(300));
    items = posts.map((p) => ({ post: p, at: p.created_at }));
    if (ids.length) {
      const reps = await q(sb.from('reposts').select('post_id, user_id, created_at').in('user_id', ids).order('created_at', { ascending: false }).limit(200));
      if (reps.length) {
        const rposts = await q(POSTS().in('id', [...new Set(reps.map((r) => r.post_id))]).is('deleted_at', null));
        const pmap = new Map(rposts.map((p) => [p.id, p]));
        const names = new Map((await q(sb.from('profiles').select('id, username').in('id', [...new Set(reps.map((r) => r.user_id))]))).map((x) => [x.id, x.username]));
        for (const r of reps) if (pmap.has(r.post_id)) items.push({ post: pmap.get(r.post_id), at: r.created_at, repostedBy: names.get(r.user_id) });
      }
    }
    items.sort((a, b) => new Date(b.at) - new Date(a.at));
    const seen = new Set();
    items = items.filter((it) => !seen.has(it.post.id) && seen.add(it.post.id));
  }

  const slice = items.slice((page - 1) * SIZE, page * SIZE);
  await hydrate(slice.map((it) => it.post));

  let suggestions = [];
  if (me) {
    const fl = await q(sb.from('follows').select('followee_id').eq('follower_id', me.id));
    const skip = [me.id, ...fl.map((f) => f.followee_id)];
    suggestions = await q(sb.from('profile_view').select('*').is('banned_at', null).not('id', 'in', `(${skip.join(',')})`).order('followers', { ascending: false }).limit(5));
  }

  main.innerHTML = `
<nav class="feed-tabs">
  <a href="${u('/')}" class="${tab === 'foryou' ? 'on' : ''}">추천</a>
  <a href="${me ? u('/?feed=following') : u('/login?next=' + encodeURIComponent('/?feed=following'))}" class="${tab === 'following' ? 'on' : ''}">팔로잉</a>
</nav>
<section class="feed">
  ${me ? composerHtml({ compact: true, id: 'home-composer' }) : `
    <div class="welcome">
      <span class="logo big">ssayuz</span>
      <h1 class="h2">짧게 말하고, 길게 이어지는 곳</h1>
      <p class="muted">500자 Snippet으로 생각을 나누고, 답글로 대화해요.</p>
      <div class="row centered"><a class="btn btn-ink" href="${u('/signup')}">가입하기</a><a class="btn" href="${u('/login')}">로그인</a></div>
    </div>`}
  ${slice.length === 0 ? `<div class="empty">${tab === 'following' ? `팔로우한 사람의 Snippet이 아직 없어요.<br><a class="bold" href="${u('/search')}">사람 찾아보기 →</a>` : '아직 Snippet이 없어요. 첫 Snippet을 올려 보세요!'}</div>` : ''}
  ${slice.map((it, i) => postHtml(it.post, { repostedBy: it.repostedBy }) + (i === 2 && suggestions.length ? `
    <div class="suggest"><div class="suggest-title">팔로우 추천</div><div class="suggest-row">
      ${suggestions.map((s) => `<div class="suggest-card"><a href="${u('/@' + s.username)}">${avatar(s, 56)}</a><a class="bold small" href="${u('/@' + s.username)}">${esc(s.display_name)}</a><span class="tiny muted">@${esc(s.username)}</span>${followBtn(s, false, false, true)}</div>`).join('')}
    </div></div>` : '')).join('')}
  ${items.length > page * SIZE ? `<div class="more"><a class="btn" href="${u(`/?${tab === 'following' ? 'feed=following&' : ''}page=${page + 1}`)}">더 보기</a></div>` : ''}
</section>`;
  const form = document.getElementById('home-composer');
  if (form) wireComposer(form, { onDone: (ids) => go(`/@${me.username}/post/${ids[0]}`) });
}

async function viewCompose(params) {
  if (!state.me) return needLogin();
  const parent = params.get('reply') ? await getPost(Number(params.get('reply'))) : null;
  const quote = params.get('quote') ? await getPost(Number(params.get('quote'))) : null;
  if ((params.get('reply') && (!parent || parent.deleted_at)) || (params.get('quote') && (!quote || quote.deleted_at))) return notFound('Snippet을 찾을 수 없어요.');
  if (parent) {
    const allowed = await q(sb.rpc('can_reply', { p_post: parent.id }));
    if (!allowed) return notFound('작성자가 답글을 달 수 있는 사람을 제한했어요.', '답글 제한');
  }
  const title = parent ? '답글 쓰기' : quote ? '인용하기' : '새 Snippet';
  setTitle(title);
  main.innerHTML = `${pageHead(title)}
<section class="feed">
  ${parent ? postHtml(parent, { line: true }) : ''}
  ${composerHtml({ parentId: parent?.id, quote, placeholder: parent ? `@${parent.username}님에게 답글...` : null })}
</section>
<p class="center tiny muted mt">Ctrl(⌘) + Enter로 바로 게시할 수 있어요.</p>`;
  if (quote) await hydrate([quote]);
  wireComposer(document.getElementById('composer'), {
    parentId: parent?.id, quoteId: quote?.id,
    onDone: (ids) => go(parent ? `/@${parent.username}/post/${parent.id}#post-${ids[0]}` : `/@${state.me.username}/post/${ids[0]}`),
  });
  document.querySelector('#composer textarea').focus();
}

async function viewPost(username, id) {
  const post = await getPost(id);
  if (!post) return notFound('Snippet을 찾을 수 없어요.');
  if (post.username !== username.toLowerCase()) return go(`/@${post.username}/post/${post.id}`, true);
  const ancestors = [];
  let cur = post;
  for (let i = 0; i < 30 && cur.parent_id; i++) {
    const up = await getPost(cur.parent_id);
    if (!up) { ancestors.unshift({ missing: true }); break; }
    ancestors.unshift(up);
    cur = up;
  }
  const replies = await q(POSTS().eq('parent_id', post.id).is('deleted_at', null).order('created_at'));
  replies.sort((a, b) => (b.user_id === post.user_id) - (a.user_id === post.user_id) || b.likes - a.likes || new Date(a.created_at) - new Date(b.created_at));
  await hydrate([post, ...ancestors.filter((a) => !a.missing), ...replies]);
  const canReply = state.me && !post.deleted_at ? await q(sb.rpc('can_reply', { p_post: post.id })) : false;
  setTitle(`${post.display_name}: ${post.deleted_at ? '삭제된 Snippet' : post.body.slice(0, 40)}`);
  const here = `/@${post.username}/post/${post.id}`;
  main.innerHTML = `${pageHead('Snippet')}
<section class="feed">
  ${ancestors.map((a) => postHtml(a, { line: true })).join('')}
  ${postHtml(post, { big: true })}
  <div id="reply">
    ${canReply ? composerHtml({ compact: true, id: 'reply-composer', parentId: post.id, placeholder: `@${post.username}님에게 답글...` })
      : !state.me && !post.deleted_at ? `<div class="reply-locked"><a class="bold" href="${u('/login?next=' + encodeURIComponent(here))}">로그인</a>하고 답글을 남겨 보세요.</div>`
      : !post.deleted_at ? '<div class="reply-locked">작성자가 답글을 달 수 있는 사람을 제한했어요.</div>' : ''}
  </div>
  ${replies.length ? `<div class="section-label">답글 ${replies.length}</div>` : ''}
  ${replies.map((r) => postHtml(r)).join('')}
</section>`;
  const form = document.getElementById('reply-composer');
  if (form) wireComposer(form, { parentId: post.id, onDone: (ids) => { history.replaceState(null, '', u(here) + '#post-' + ids[0]); render(); } });
}

async function viewProfile(username, params) {
  const member = await q(sb.from('profile_view').select('*').eq('username', username.toLowerCase()).maybeSingle());
  if (!member) return notFound('없는 사람이에요.');
  if (member.username !== username) return go('/@' + member.username, true);
  const me = state.me;
  const tab = ['replies', 'reposts'].includes(params.get('tab')) ? params.get('tab') : 'threads';
  const isMe = !!me && me.id === member.id;
  let following = false, followsMe = false;
  if (me && !isMe) {
    const rel = await q(sb.from('follows').select('follower_id, followee_id').or(`and(follower_id.eq.${me.id},followee_id.eq.${member.id}),and(follower_id.eq.${member.id},followee_id.eq.${me.id})`));
    following = rel.some((r) => r.follower_id === me.id);
    followsMe = rel.some((r) => r.follower_id === member.id);
  }
  let posts = [];
  if (tab === 'threads') posts = await q(POSTS().eq('user_id', member.id).is('parent_id', null).is('deleted_at', null).order('id', { ascending: false }).limit(60));
  else if (tab === 'replies') posts = await q(POSTS().eq('user_id', member.id).not('parent_id', 'is', null).is('deleted_at', null).order('id', { ascending: false }).limit(60));
  else {
    const reps = await q(sb.from('reposts').select('post_id').eq('user_id', member.id).order('created_at', { ascending: false }).limit(60));
    if (reps.length) {
      const got = await q(POSTS().in('id', reps.map((r) => r.post_id)).is('deleted_at', null));
      const map = new Map(got.map((p) => [p.id, p]));
      posts = reps.map((r) => map.get(r.post_id)).filter(Boolean);
    }
  }
  await hydrate(posts);
  setTitle(`${member.display_name} (@${member.username})`);
  main.innerHTML = `
<section class="feed">
  <div class="profile">
    <div class="profile-top">
      <div class="grow">
        <h1 class="profile-name">${esc(member.display_name)}</h1>
        <div class="profile-handle">@${esc(member.username)}${followsMe ? ' <span class="tag">나를 팔로우해요</span>' : ''}${member.role === 'admin' ? ' <span class="tag tag-user">관리자</span>' : ''}</div>
      </div>
      ${avatar(member, 84)}
    </div>
    ${member.banned_at ? '<div class="alert">이용이 제한된 계정이에요.</div>' : ''}
    ${member.bio ? `<p class="bio">${rich(member.bio)}</p>` : ''}
    <div class="profile-meta">
      <a href="${u(`/@${member.username}/followers`)}">팔로워 <b class="follower-count">${num(member.followers)}</b>명</a><span>·</span>
      <a href="${u(`/@${member.username}/following`)}">팔로잉 <b>${num(member.following)}</b>명</a>
      ${member.link ? `<span>·</span><a class="profile-link" href="${esc(member.link)}" target="_blank" rel="noopener noreferrer nofollow">${icon('link', 15)} ${esc(member.link.replace(/^https?:\/\//, '').slice(0, 30))}</a>` : ''}
    </div>
    <div class="profile-btns">
      ${isMe ? `<a class="btn btn-block" href="${u('/settings')}">프로필 편집</a><button type="button" class="btn btn-block" data-copy="${abs('/@' + member.username)}">프로필 공유</button>`
        : me ? `${followBtn(member, following, followsMe, true)}${member.banned_at ? '' : `<a class="btn btn-block" href="${u('/dm/@' + member.username)}">메시지</a>`}`
        : `<a class="btn btn-ink btn-block" href="${u('/login?next=' + encodeURIComponent('/@' + member.username))}">팔로우</a>`}
    </div>
    ${isAdmin() && !isMe ? `<div class="admin-bar" id="admin">${icon('shield', 18)} <b>관리</b>
      ${member.role === 'admin' ? '<span class="small muted">관리자 계정이에요</span>'
        : member.banned_at ? `<span class="small">차단됨${member.ban_reason ? ' · ' + esc(member.ban_reason) : ''}</span><button class="btn btn-sm" data-unban="${member.id}">차단 해제</button>`
        : `<span class="ban-form"><input id="ban-reason" placeholder="사유 (선택)" maxlength="100" aria-label="차단 사유"><button class="btn btn-sm btn-danger" data-ban="${member.id}" data-name="${esc(member.username)}">계정 차단</button></span>`}
    </div>` : ''}
  </div>
  <nav class="feed-tabs in-profile">
    <a href="${u('/@' + member.username)}" class="${tab === 'threads' ? 'on' : ''}">Snippet</a>
    <a href="${u('/@' + member.username + '?tab=replies')}" class="${tab === 'replies' ? 'on' : ''}">답글</a>
    <a href="${u('/@' + member.username + '?tab=reposts')}" class="${tab === 'reposts' ? 'on' : ''}">리포스트</a>
  </nav>
  ${isMe && tab === 'threads' ? composerHtml({ compact: true, id: 'profile-composer' }) : ''}
  ${posts.length === 0 ? `<div class="empty">${tab === 'threads' ? '아직 Snippet이 없어요.' : tab === 'replies' ? '아직 답글이 없어요.' : '아직 리포스트한 Snippet이 없어요.'}</div>` : ''}
  ${posts.map((p) => postHtml(p, { showParent: tab === 'replies', repostedBy: tab === 'reposts' ? member.username : null })).join('')}
</section>`;
  const form = document.getElementById('profile-composer');
  if (form) wireComposer(form, { onDone: (ids) => go(`/@${me.username}/post/${ids[0]}`) });
}

async function viewPeople(username, list) {
  const member = await q(sb.from('profiles').select('id, username').eq('username', username.toLowerCase()).maybeSingle());
  if (!member) return notFound('없는 사람이에요.');
  const col = list === 'followers' ? 'followee_id' : 'follower_id';
  const other = list === 'followers' ? 'follower_id' : 'followee_id';
  const rows = await q(sb.from('follows').select(other).eq(col, member.id).order('created_at', { ascending: false }));
  const people = rows.length ? await q(sb.from('profiles').select('username, display_name, bio').in('id', rows.map((r) => r[other]))) : [];
  const label = list === 'followers' ? '팔로워' : '팔로잉';
  setTitle(`@${member.username}의 ${label}`);
  main.innerHTML = `${pageHead(`@${esc(member.username)} · ${label}`)}
<section class="feed">
  ${people.length === 0 ? '<div class="empty">아직 아무도 없어요.</div>' : ''}
  ${people.map((p) => `<a class="person" href="${u('/@' + p.username)}">${avatar(p, 44)}<div class="grow"><div class="bold">${esc(p.display_name)}</div><div class="small muted">@${esc(p.username)}</div>${p.bio ? `<div class="small person-bio">${esc(p.bio)}</div>` : ''}</div></a>`).join('')}
</section>`;
}

async function viewSearch(params) {
  const raw = (params.get('q') || '').trim().slice(0, 50);
  const term = cleanQuery(raw.replace(/^@/, ''));
  let people = [], posts = [];
  if (raw) {
    if (!raw.startsWith('#') && term) {
      people = await q(sb.from('profile_view').select('*').is('banned_at', null).or(`username.ilike.*${term}*,display_name.ilike.*${term}*`).order('followers', { ascending: false }).limit(10));
    }
    const bodyTerm = raw.startsWith('#') ? '#' + cleanQuery(raw.slice(1)) : term;
    if (bodyTerm && bodyTerm !== '#') posts = await hydrate(await q(POSTS().is('deleted_at', null).ilike('body', `%${bodyTerm}%`).order('id', { ascending: false }).limit(40)));
  } else {
    let query = sb.from('profile_view').select('*').is('banned_at', null);
    if (state.me) query = query.neq('id', state.me.id);
    people = await q(query.order('followers', { ascending: false }).limit(15));
  }
  setTitle(raw ? `'${raw}' 검색` : '검색');
  main.innerHTML = `
<section class="feed">
  <form class="searchbox" id="search-form" role="search">${icon('search', 20)}<input type="search" name="q" value="${esc(raw)}" placeholder="사람, Snippet, #태그 검색" aria-label="검색"></form>
  ${people.length ? `<div class="section-label">${raw ? '사람' : '팔로우 추천'}</div>` : ''}
  ${people.map((p) => `<div class="person"><a href="${u('/@' + p.username)}">${avatar(p, 44)}</a><a class="grow" href="${u('/@' + p.username)}"><div class="bold">${esc(p.display_name)}</div><div class="small muted">@${esc(p.username)} · 팔로워 ${num(p.followers)}명</div>${p.bio ? `<div class="small person-bio">${esc(p.bio)}</div>` : ''}</a></div>`).join('')}
  ${raw ? `<div class="section-label">Snippet</div>${posts.length === 0 ? `<div class="empty">'${esc(raw)}'에 맞는 Snippet이 없어요.</div>` : ''}${posts.map((p) => postHtml(p, { showParent: true })).join('')}` : ''}
</section>`;
  const form = document.getElementById('search-form');
  form.addEventListener('submit', (e) => { e.preventDefault(); go('/search?q=' + encodeURIComponent(form.q.value.trim())); });
  if (!raw) form.q.focus();
}

async function viewActivity() {
  if (!state.me) return needLogin();
  const notes = await q(sb.from('notifications').select('*').order('id', { ascending: false }).limit(100));
  const actors = notes.length ? await q(sb.from('profiles').select('id, username, display_name').in('id', [...new Set(notes.map((n) => n.actor_id))])) : [];
  const amap = new Map(actors.map((a) => [a.id, a]));
  const say = { like: '내 Snippet을 좋아해요', reply: '내 Snippet에 답글을 달았어요', repost: '내 Snippet을 리포스트했어요', quote: '내 Snippet을 인용했어요', follow: '나를 팔로우하기 시작했어요', mention: '나를 언급했어요' };
  const ico = { like: 'heart', reply: 'reply', repost: 'repost', quote: 'quote', follow: 'user', mention: 'reply' };
  setTitle('활동');
  main.innerHTML = `${pageHead('활동', false, notes.length ? '<button class="linkbtn small" data-clear-activity>모두 지우기</button>' : '<span class="icon-btn"></span>')}
<section class="feed">
  ${notes.length === 0 ? '<div class="empty">아직 활동이 없어요.<br><span class="small">누군가 좋아요를 누르거나 답글을 달면 여기에 보여요.</span></div>' : ''}
  ${notes.map((n) => {
    const a = amap.get(n.actor_id) || { username: '?', display_name: '?' };
    const href = n.type === 'follow' || !n.post_id ? '/@' + a.username : '/post/' + n.post_id;
    return `<a class="note ${n.read_at ? '' : 'unread'}" href="${u(href)}">
      <span class="note-av">${avatar(a, 40)}<span class="note-ico t-${n.type}">${icon(ico[n.type] || 'heart', 11)}</span></span>
      <div class="grow"><div class="small"><b>@${esc(a.username)}</b>님이 ${say[n.type] || ''} <span class="muted">${ago(n.created_at)}</span></div>${n.snippet ? `<div class="note-snippet small muted">${esc(n.snippet)}</div>` : ''}</div>
      ${n.read_at ? '' : '<span class="new-dot" aria-label="새 활동"></span>'}</a>`;
  }).join('')}
</section>`;
  if (notes.some((n) => !n.read_at)) {
    await sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
    state.unreadNotes = 0;
  }
}

async function viewInbox() {
  if (!state.me) return needLogin();
  const me = state.me.id;
  const msgs = await q(sb.from('dm_messages').select('*').order('id', { ascending: false }).limit(500));
  const threads = new Map();
  for (const m of msgs) {
    const other = m.sender_id === me ? m.recipient_id : m.sender_id;
    if (!threads.has(other)) threads.set(other, { last: m, unread: 0 });
    if (m.recipient_id === me && !m.read_at) threads.get(other).unread++;
  }
  const people = threads.size ? await q(sb.from('profiles').select('id, username, display_name').in('id', [...threads.keys()])) : [];
  const pmap = new Map(people.map((p) => [p.id, p]));
  setTitle('메시지');
  main.innerHTML = `${pageHead('메시지', false)}
<section class="feed">
  ${threads.size === 0 ? '<div class="empty">아직 주고받은 메시지가 없어요.<br><span class="small">상대 프로필에서 <b>메시지</b> 버튼을 눌러 시작해 보세요.</span></div>' : ''}
  ${[...threads].map(([id, t]) => {
    const p = pmap.get(id);
    if (!p) return '';
    return `<a class="thread-row ${t.unread ? 'unread' : ''}" href="${u('/dm/@' + p.username)}">${avatar(p, 44)}
      <div class="grow"><div class="row between"><span class="bold">@${esc(p.username)}</span><span class="tiny muted light">${ago(t.last.created_at)}</span></div>
      <div class="thread-last small">${t.last.sender_id === me ? '나: ' : ''}${esc(t.last.body)}</div></div>
      ${t.unread ? `<span class="dot-count">${t.unread}</span>` : ''}</a>`;
  }).join('')}
</section>`;
}

async function viewThread(username) {
  if (!state.me) return needLogin();
  const me = state.me.id;
  const other = await q(sb.from('profiles').select('id, username, display_name, banned_at').eq('username', username.toLowerCase()).maybeSingle());
  if (!other) return notFound('없는 사람이에요.');
  if (other.id === me) return go('/dm', true);
  const pair = `and(sender_id.eq.${me},recipient_id.eq.${other.id}),and(sender_id.eq.${other.id},recipient_id.eq.${me})`;
  const msgs = await q(sb.from('dm_messages').select('*').or(pair).order('id', { ascending: false }).limit(200));
  msgs.reverse();
  setTitle(`@${other.username}와의 대화`);
  const msgHtml = (m) => `<div class="msg ${m.sender_id === me ? 'mine' : 'theirs'}" data-id="${m.id}"><div class="msg-body">${esc(m.body)}</div><div class="msg-meta">${shortTime(m.created_at)} ${m.sender_id === me ? `<span class="msg-read">${m.read_at ? '읽음' : ''}</span>` : ''}</div></div>`;
  main.innerHTML = `
<section class="feed chat">
  <div class="box-head"><div class="row">
    <a href="${u('/dm')}" class="icon-btn" aria-label="메시지 목록">${icon('back')}</a>
    <a href="${u('/@' + other.username)}">${avatar(other, 36)}</a>
    <div><a class="bold" href="${u('/@' + other.username)}">@${esc(other.username)}</a><div class="tiny muted light">${esc(other.display_name)}</div></div>
  </div></div>
  <div class="chat-log" id="chat-log">${msgs.length ? msgs.map(msgHtml).join('') : '<div class="empty small chat-empty">첫 메시지를 보내 보세요 👋</div>'}</div>
  ${other.banned_at ? '<div class="empty small">이용이 제한된 사람이라 메시지를 보낼 수 없어요.</div>' : `
  <form class="chat-form" id="chat-form">
    <textarea name="body" rows="1" maxlength="1000" required placeholder="메시지 보내기..." aria-label="메시지"></textarea>
    <button class="btn btn-ink">보내기</button>
  </form>`}
</section>`;
  const log = document.getElementById('chat-log');
  const toBottom = () => { log.scrollTop = log.scrollHeight; };
  const lastId = () => Math.max(0, ...[...log.querySelectorAll('.msg')].map((m) => Number(m.dataset.id)));
  const add = (m) => {
    if (log.querySelector(`.msg[data-id="${m.id}"]`)) return;
    log.querySelector('.chat-empty')?.remove();
    log.insertAdjacentHTML('beforeend', msgHtml(m));
  };
  const markRead = async () => { await sb.rpc('mark_dm_read', { p_other: other.id }); };
  async function poll() {
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    const fresh = await q(sb.from('dm_messages').select('*').or(pair).gt('id', lastId()).order('id').limit(100));
    fresh.forEach(add);
    if (fresh.some((m) => m.sender_id === other.id)) await markRead();
    const mine = await q(sb.from('dm_messages').select('id, read_at').eq('sender_id', me).eq('recipient_id', other.id).not('read_at', 'is', null).order('id', { ascending: false }).limit(1));
    const upTo = mine[0]?.id || 0;
    log.querySelectorAll('.msg.mine').forEach((el) => { if (Number(el.dataset.id) <= upTo) el.querySelector('.msg-read').textContent = '읽음'; });
    if (fresh.length && stick) toBottom();
  }
  toBottom();
  await markRead();
  every(3000, () => poll().catch(() => {}));
  const form = document.getElementById('chat-form');
  if (form) {
    const ta = form.querySelector('textarea');
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = ta.value.trim();
      if (!body) return;
      const btn = form.querySelector('button');
      btn.disabled = true;
      try {
        const m = await q(sb.from('dm_messages').insert({ recipient_id: other.id, body }).select().single());
        add(m); ta.value = ''; ta.style.height = ''; toBottom();
      } catch (err) { toast(errMsg(err)); }
      btn.disabled = false; ta.focus();
    });
    ta.focus();
  }
}

async function viewSettings() {
  if (!state.me) return needLogin();
  const me = state.me;
  setTitle('프로필 편집');
  main.innerHTML = `${pageHead('프로필 편집')}
<section class="feed box-pad">
  <form class="stack" id="settings-form">
    <div class="row">${avatar(me, 64)}<div class="small muted">프로필 사진은 이름 첫 글자로 만들어져요.</div></div>
    <label>아이디<input value="@${esc(me.username)}" disabled></label>
    <label>이름<input name="display_name" value="${esc(me.display_name)}" required maxlength="20"></label>
    <label>소개<textarea name="bio" rows="3" maxlength="150" placeholder="나를 소개해 주세요">${esc(me.bio)}</textarea></label>
    <label>링크<input name="link" value="${esc(me.link)}" maxlength="200" placeholder="https://"></label>
    <button class="btn btn-ink btn-block">저장</button>
  </form>
  <p class="center mt"><button class="linkbtn" data-logout>로그아웃</button></p>
</section>
<section class="feed box-pad danger-zone">
  <h2 class="h2">계정 삭제</h2>
  <p class="small muted">내 계정과 내가 쓴 Snippet·답글, 좋아요, 리포스트, 팔로우, 메시지, 활동 기록이 <b>모두 지워지고 되돌릴 수 없어요.</b></p>
  <button class="btn btn-danger btn-block" data-delete-account>계정 삭제</button>
</section>
<p class="center tiny mt"><a href="terms.html" target="_blank" rel="noopener">이용약관</a> · <a href="privacy.html" target="_blank" rel="noopener">개인정보처리방침</a></p>`;
  const form = document.getElementById('settings-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.querySelector('.alert')?.remove();
    let link = form.link.value.trim();
    if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
    const patch = { display_name: form.display_name.value.trim(), bio: form.bio.value.trim(), link };
    const show = (msg, okay) => form.insertAdjacentHTML('afterbegin', `<div class="alert ${okay ? 'ok' : ''}">${esc(msg)}</div>`);
    if (!patch.display_name) return show('이름을 입력해 주세요.');
    if (link) { try { const x = new URL(link); if (!/^https?:$/.test(x.protocol) || /\s/.test(link)) throw 0; } catch { return show('링크 주소가 올바르지 않아요.'); } }
    const { error } = await sb.from('profiles').update(patch).eq('id', me.id);
    if (error) return show(errMsg(error));
    Object.assign(state.me, patch);
    show('저장했어요 ✓', true);
  });
}

function authPage(kind, params) {
  const signup = kind === 'signup';
  setTitle(signup ? '가입하기' : '로그인');
  main.innerHTML = `
<section class="feed box-pad-lg auth">
  <div class="center"><span class="logo big">ssayuz</span></div>
  <h1 class="h2 center">${signup ? '가입하기' : '로그인'}</h1>
  ${signup ? '<p class="muted center small">짧게 말하고, 길게 이어지는 곳에 오신 걸 환영해요.</p>' : ''}
  <form class="stack mt" id="auth-form">
    <label>아이디 ${signup ? '<span class="muted light">(영문 소문자, 숫자, _ . 3~20자)</span>' : ''}<input name="username" required minlength="3" maxlength="20" autocomplete="username" autocapitalize="none" spellcheck="false"></label>
    ${signup ? '<label>이름<input name="display_name" required maxlength="20" placeholder="Snippet에 보이는 이름"></label>' : ''}
    <label>비밀번호<input type="password" name="password" required minlength="6" autocomplete="${signup ? 'new-password' : 'current-password'}" ${signup ? 'placeholder="6자 이상"' : ''}></label>
    ${signup ? `<label class="check-row"><input type="checkbox" name="agree" required> <span>만 14세 이상이며 <a href="terms.html" target="_blank" rel="noopener">이용약관</a>과 <a href="privacy.html" target="_blank" rel="noopener">개인정보처리방침</a>에 동의해요</span></label>` : ''}
    <button class="btn btn-ink btn-block">${signup ? '가입하기' : '로그인'}</button>
  </form>
  <p class="center small mt">${signup ? `이미 계정이 있나요? <a href="${u('/login')}" class="bold">로그인</a>` : `처음이에요? <a href="${u('/signup')}" class="bold">가입하기</a>`}</p>
  <p class="center tiny muted">비밀번호를 잊으면 찾을 수 없어요. 꼭 기억해 두세요.</p>
</section>`;
  const form = document.getElementById('auth-form');
  form.username.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.querySelector('.alert')?.remove();
    const show = (msg) => form.insertAdjacentHTML('afterbegin', `<div class="alert">${esc(msg)}</div>`);
    const username = form.username.value.trim().toLowerCase();
    const password = form.password.value;
    const btn = form.querySelector('button');
    if (!/^[a-z0-9_.]{3,20}$/.test(username)) return show('아이디는 영문 소문자, 숫자, _ . 로 3~20자예요.');
    btn.disabled = true;
    try {
      if (signup) {
        const display_name = form.display_name.value.trim();
        if (!display_name) throw new Error('이름을 입력해 주세요.');
        if (password.length < 6) throw new Error('비밀번호는 6자 이상이어야 해요.');
        if (!form.agree.checked) throw new Error('이용약관과 개인정보처리방침에 동의해 주세요.');
        const taken = await q(sb.from('profiles').select('id').eq('username', username).maybeSingle());
        if (taken) throw new Error('이미 사용 중인 아이디예요.');
        const { data, error } = await sb.auth.signUp({ email: emailOf(username), password, options: { data: { username, display_name } } });
        if (error) throw error;
        if (!data.session) throw new Error('가입은 됐지만 로그인되지 않았어요. 관리자에게 Supabase의 "Confirm email" 설정을 꺼 달라고 해 주세요.');
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: emailOf(username), password });
        if (error) throw error;
      }
      await loadMe();
      const next = params.get('next');
      go(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', true);
    } catch (err) {
      show(errMsg(err));
      btn.disabled = false;
    }
  });
}

async function viewAdmin(params) {
  if (!isAdmin()) return notFound('관리자만 볼 수 있어요.', '403');
  const tab = ['users', 'hidden', 'log'].includes(params.get('tab')) ? params.get('tab') : 'overview';
  const qtext = cleanQuery(params.get('q') || '');
  const dayAgo = new Date(Date.now() - 86400000).toISOString();
  const cnt = async (b) => (await b).count || 0;
  const [users, banned, today, hidden] = await Promise.all([
    cnt(sb.from('profiles').select('id', { count: 'exact', head: true })),
    cnt(sb.from('profiles').select('id', { count: 'exact', head: true }).not('banned_at', 'is', null)),
    cnt(sb.from('posts').select('id', { count: 'exact', head: true }).gt('created_at', dayAgo)),
    cnt(sb.from('posts').select('id', { count: 'exact', head: true }).not('hidden_at', 'is', null)),
  ]);
  const postRow = (p) => `<div class="admin-row ${p.hidden_at ? 'is-hidden' : ''}"><div class="grow">
      <a href="${u(`/@${p.username}/post/${p.id}`)}" class="admin-body">${esc(p.body.slice(0, 120)) || '(내용 없음)'}</a>
      <div class="tiny muted">@${esc(p.username)} · ${p.parent_id ? '답글' : 'Snippet'} · ${ago(p.created_at)}${p.hidden_at ? ' · <b>숨김</b>' : ''}</div></div>
      <button class="btn btn-sm" data-hide="${p.id}" data-hidden="${p.hidden_at ? 1 : 0}">${p.hidden_at ? '복구' : '숨기기'}</button></div>`;
  let body = '';
  if (tab === 'overview') {
    const rows = await q(POSTS().is('deleted_at', null).order('id', { ascending: false }).limit(40));
    body = rows.length ? rows.map(postRow).join('') : '<div class="empty">아직 Snippet이 없어요.</div>';
  } else if (tab === 'hidden') {
    const rows = await q(POSTS().not('hidden_at', 'is', null).order('hidden_at', { ascending: false }));
    body = rows.length ? rows.map(postRow).join('') : '<div class="empty">숨긴 Snippet이 없어요.</div>';
  } else if (tab === 'users') {
    let query = sb.from('profile_view').select('*');
    if (qtext) query = query.or(`username.ilike.*${qtext}*,display_name.ilike.*${qtext}*`);
    const rows = await q(query.order('created_at', { ascending: false }).limit(100));
    body = `<form class="searchbox" id="admin-search">${icon('search', 20)}<input type="search" name="q" value="${esc(qtext)}" placeholder="아이디나 이름" aria-label="사용자 검색"></form>` +
      rows.map((x) => `<div class="admin-row ${x.banned_at ? 'is-hidden' : ''}"><div class="grow">
        <a class="bold" href="${u('/@' + x.username)}">@${esc(x.username)}</a> <span class="small">${esc(x.display_name)}</span>
        ${x.role === 'admin' ? '<span class="tag tag-user">관리자</span>' : ''}${x.banned_at ? '<span class="tag tag-hot">차단됨</span>' : ''}
        <div class="tiny muted">팔로워 ${x.followers} · 가입 ${ago(x.created_at)}${x.ban_reason ? ' · 사유: ' + esc(x.ban_reason) : ''}</div></div>
        ${x.id === state.me.id ? '<span class="tiny muted">나</span>'
          : x.banned_at ? `<button class="btn btn-sm" data-unban="${x.id}">차단 해제</button>`
          : x.role === 'admin' ? `<button class="linkbtn tiny" data-role="${x.id}" data-to="user">관리자 해제</button>`
          : `<button class="btn btn-sm btn-danger" data-ban="${x.id}" data-name="${esc(x.username)}">차단</button><button class="linkbtn tiny" data-role="${x.id}" data-to="admin">관리자로</button>`}
      </div>`).join('');
  } else {
    const rows = await q(sb.from('admin_log').select('*').order('id', { ascending: false }).limit(200));
    const admins = rows.length ? await q(sb.from('profiles').select('id, username').in('id', [...new Set(rows.map((r) => r.admin_id).filter(Boolean))])) : [];
    const amap = new Map(admins.map((a) => [a.id, a.username]));
    body = rows.length ? rows.map((l) => `<div class="admin-row"><div class="grow"><b>${esc(l.action)}</b> · ${esc(l.target)}${l.note ? ` <span class="muted">— ${esc(l.note)}</span>` : ''}<div class="tiny muted">@${esc(amap.get(l.admin_id) || '?')} · ${fullTime(l.created_at)}</div></div></div>`).join('') : '<div class="empty">기록이 없어요.</div>';
  }
  setTitle('관리');
  main.innerHTML = `${pageHead(icon('shield', 20) + ' 관리', false)}
<div class="stat-grid">
  <div class="stat-card"><b>${users}</b><span>가입자</span></div><div class="stat-card"><b>${banned}</b><span>차단 계정</span></div>
  <div class="stat-card"><b>${today}</b><span>오늘 Snippet</span></div><div class="stat-card"><b>${hidden}</b><span>숨긴 Snippet</span></div>
</div>
<nav class="feed-tabs">
  <a href="${u('/admin')}" class="${tab === 'overview' ? 'on' : ''}">최근 Snippet</a>
  <a href="${u('/admin?tab=users')}" class="${tab === 'users' ? 'on' : ''}">사용자</a>
  <a href="${u('/admin?tab=hidden')}" class="${tab === 'hidden' ? 'on' : ''}">숨긴 Snippet</a>
  <a href="${u('/admin?tab=log')}" class="${tab === 'log' ? 'on' : ''}">기록</a>
</nav>
<section class="feed">${body}</section>`;
  document.getElementById('admin-search')?.addEventListener('submit', (e) => { e.preventDefault(); go('/admin?tab=users&q=' + encodeURIComponent(e.target.q.value.trim())); });
}

function notFound(message = '여긴 아무것도 없어요.', title = '404') {
  setTitle(title);
  main.innerHTML = `<section class="feed box-pad-lg center"><h1 class="h1">${esc(title)}</h1><p class="muted">${esc(message)}</p>
    <div class="row mt centered"><a class="btn" href="${u('/')}" data-back>← 뒤로</a><a class="btn btn-ink" href="${u('/')}">홈으로</a></div></section>`;
}

function setupNeeded() {
  main.innerHTML = `<section class="feed setup"><h1 class="h2">거의 다 됐어요! 🛠</h1>
    <p>사이트는 올라갔지만 아직 Supabase(DB)와 연결되지 않았어요.</p>
    <p><code>docs/js/config.js</code> 파일의 <code>SUPABASE_URL</code>, <code>SUPABASE_ANON_KEY</code> 값을 내 Supabase 프로젝트 값으로 바꿔 주세요.</p>
    <p class="small muted">자세한 방법은 저장소의 DEPLOY.md를 봐 주세요.</p></section>`;
}

// ---------------------------------------------------------------------
// 라우터
// ---------------------------------------------------------------------
function currentPath() {
  let p = location.pathname;
  if (p.startsWith(BASE)) p = '/' + p.slice(BASE.length);
  try { p = decodeURIComponent(p); } catch { /* 그대로 */ }
  return p.replace(/\/index\.html$|\/404\.html$/, '/').replace(/(.)\/$/, '$1') || '/';
}

const ROUTES = [
  [/^\/$/, (m, p) => viewHome(p)],
  [/^\/compose$/, (m, p) => viewCompose(p)],
  [/^\/@([a-zA-Z0-9_.]+)\/post\/(\d+)$/, (m) => viewPost(m[1], Number(m[2]))],
  [/^\/post\/(\d+)$/, async (m) => { const p = await getPost(Number(m[1])); return p ? go(`/@${p.username}/post/${p.id}`, true) : notFound('Snippet을 찾을 수 없어요.'); }],
  [/^\/@([a-zA-Z0-9_.]+)\/(followers|following)$/, (m) => viewPeople(m[1], m[2])],
  [/^\/@([a-zA-Z0-9_.]+)$/, (m, p) => viewProfile(m[1], p)],
  [/^\/search$/, (m, p) => viewSearch(p)],
  [/^\/activity$/, () => viewActivity()],
  [/^\/dm$/, () => viewInbox()],
  [/^\/dm\/@([a-zA-Z0-9_.]+)$/, (m) => viewThread(m[1])],
  [/^\/settings$/, () => viewSettings()],
  [/^\/login$/, (m, p) => (state.me ? go('/', true) : authPage('login', p))],
  [/^\/signup$/, (m, p) => (state.me ? go('/', true) : authPage('signup', p))],
  [/^\/admin$/, (m, p) => viewAdmin(p)],
];

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  state.timers.forEach(clearInterval);
  state.timers = [];
  const path = currentPath();
  const params = new URLSearchParams(location.search);
  drawNav();
  if (!CONFIGURED) return setupNeeded();
  const banner = state.me?.banned_at ? `<div class="banner">이용이 제한된 계정이에요${state.me.ban_reason ? ` (사유: ${esc(state.me.ban_reason)})` : ''}. 글쓰기와 반응을 할 수 없어요.</div>` : '';
  try {
    const route = ROUTES.find(([re]) => re.test(path));
    if (!route) notFound();
    else await route[1](path.match(route[0]), params);
  } catch (err) {
    if (seq !== renderSeq) return;
    console.error(err);
    main.innerHTML = `<section class="feed box-pad-lg center"><h1 class="h2">앗, 문제가 생겼어요</h1><p class="muted">${esc(errMsg(err))}</p><p><a class="btn" href="${location.href}">다시 시도</a></p></section>`;
  }
  if (seq !== renderSeq) return;
  if (banner) main.insertAdjacentHTML('afterbegin', banner);
  drawNav();
  refreshBadges().catch(() => {});
  if (location.hash.startsWith('#post-')) {
    const el = document.querySelector(location.hash);
    if (el) { el.classList.add('flash'); el.scrollIntoView({ block: 'center' }); }
  } else if (location.hash !== '#reply') window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------
// 공통 동작 (클릭 한 곳에서 처리)
// ---------------------------------------------------------------------
document.addEventListener('click', async (e) => {
  const t = e.target;

  // 메뉴 바깥을 누르면 닫기
  document.querySelectorAll('details.menu[open]').forEach((d) => { if (!d.contains(t)) d.removeAttribute('open'); });

  const back = t.closest('[data-back]');
  if (back) { e.preventDefault(); if (history.length > 1) history.back(); else go('/'); return; }

  const copy = t.closest('[data-copy]');
  if (copy) {
    e.preventDefault();
    copy.closest('details')?.removeAttribute('open');
    const url = copy.dataset.copy;
    // ssayuz 앱 안이면 안드로이드 공유 창
    if (window.SsayuzApp && typeof window.SsayuzApp.share === 'function') { window.SsayuzApp.share(url); return; }
    // 휴대폰: 공유 창 (HTTPS에서만 됨)
    if (navigator.share && window.isSecureContext && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ url }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
    }
    if (await copyText(url)) toast('링크를 복사했어요');
    else prompt('아래 링크를 길게 눌러 복사하세요', url);
    return;
  }

  const needMe = () => { if (!state.me) { needLogin(); return false; } return true; };

  const like = t.closest('[data-like]');
  if (like) {
    if (!needMe()) return;
    const id = Number(like.dataset.like);
    const on = !like.classList.contains('on');
    const { error } = on ? await sb.from('post_likes').insert({ post_id: id }) : await sb.from('post_likes').delete().eq('post_id', id).eq('user_id', state.me.id);
    if (error) return toast(errMsg(error));
    const n = like.querySelector('.n');
    const count = (Number(n.dataset.raw) || 0) + (on ? 1 : -1);
    n.dataset.raw = count;
    n.textContent = count > 0 ? num(count) : '';
    like.classList.toggle('on', on);
    like.setAttribute('aria-pressed', String(on));
    like.classList.remove('pop'); void like.offsetWidth; like.classList.add('pop');
    return;
  }

  const rep = t.closest('[data-repost]');
  if (rep) {
    if (!needMe()) return;
    const id = Number(rep.dataset.repost);
    const menu = rep.closest('details');
    const sum = menu.querySelector('summary');
    const on = !sum.classList.contains('on-repost');
    const { error } = on ? await sb.from('reposts').insert({ post_id: id }) : await sb.from('reposts').delete().eq('post_id', id).eq('user_id', state.me.id);
    menu.removeAttribute('open');
    if (error) return toast(errMsg(error));
    const n = sum.querySelector('.n');
    const count = (Number(n.dataset.raw) || 0) + (on ? 1 : -1);
    n.dataset.raw = count;
    n.textContent = count > 0 ? num(count) : '';
    sum.classList.toggle('on-repost', on);
    rep.querySelector('.repost-label').textContent = on ? '리포스트 취소' : '리포스트';
    return toast(on ? '리포스트했어요' : '리포스트를 취소했어요');
  }

  const fol = t.closest('[data-follow]');
  if (fol) {
    if (!needMe()) return;
    const id = fol.dataset.follow;
    const on = fol.dataset.following !== '1';
    const { error } = on ? await sb.from('follows').insert({ followee_id: id }) : await sb.from('follows').delete().eq('follower_id', state.me.id).eq('followee_id', id);
    if (error) return toast(errMsg(error));
    fol.dataset.following = on ? '1' : '0';
    fol.textContent = on ? '팔로잉' : '팔로우';
    if (fol.classList.contains('btn-block')) fol.classList.toggle('btn-ink', !on);
    const fc = document.querySelector('.profile .follower-count');
    if (fc) fc.textContent = num((Number(fc.textContent) || 0) + (on ? 1 : -1));
    return;
  }

  const del = t.closest('[data-delete]');
  if (del) {
    if (!confirm('이 Snippet을 삭제할까요?')) return;
    const { error } = await sb.rpc('delete_post', { p_id: Number(del.dataset.delete) });
    if (error) return toast(errMsg(error));
    toast('삭제했어요');
    return render();
  }

  const hide = t.closest('[data-hide]');
  if (hide) {
    const { error } = await sb.rpc('admin_set_hidden', { p_id: Number(hide.dataset.hide), p_hidden: hide.dataset.hidden !== '1' });
    if (error) return toast(errMsg(error));
    toast(hide.dataset.hidden === '1' ? '숨김을 해제했어요' : '숨겼어요');
    return render();
  }

  const ban = t.closest('[data-ban]');
  if (ban) {
    if (!confirm(`@${ban.dataset.name} 계정을 차단할까요?`)) return;
    const reason = document.getElementById('ban-reason')?.value || prompt('차단 사유 (선택)') || '';
    const { error } = await sb.rpc('admin_ban', { p_user: ban.dataset.ban, p_reason: reason });
    if (error) return toast(errMsg(error));
    toast('차단했어요');
    return render();
  }
  const unban = t.closest('[data-unban]');
  if (unban) {
    const { error } = await sb.rpc('admin_unban', { p_user: unban.dataset.unban });
    if (error) return toast(errMsg(error));
    return render();
  }
  const role = t.closest('[data-role]');
  if (role) {
    if (!confirm('권한을 바꿀까요?')) return;
    const { error } = await sb.rpc('admin_set_role', { p_user: role.dataset.role, p_role: role.dataset.to });
    if (error) return toast(errMsg(error));
    return render();
  }

  if (t.closest('[data-delete-account]')) {
    const name = state.me?.username;
    if (!name) return;
    if (!confirm('정말 계정을 삭제할까요? 모든 Snippet과 메시지가 지워지고 되돌릴 수 없어요.')) return;
    const typed = prompt(`확인을 위해 아이디(${name})를 입력해 주세요.`);
    if ((typed || '').trim().toLowerCase() !== name) return toast('아이디가 맞지 않아 취소했어요');
    const { error } = await sb.rpc('delete_my_account');
    if (error) return toast(errMsg(error));
    await sb.auth.signOut().catch(() => {});
    state.me = null;
    toast('계정을 삭제했어요. 그동안 고마웠어요!');
    return go('/');
  }

  if (t.closest('[data-logout]')) {
    await sb.auth.signOut();
    state.me = null;
    return go('/');
  }

  if (t.closest('[data-clear-activity]')) {
    if (!confirm('활동 기록을 모두 지울까요?')) return;
    await sb.from('notifications').delete().eq('user_id', state.me.id);
    return render();
  }

  // 사이트 안 링크는 새로고침 없이 이동
  const a = t.closest('a[href]');
  if (a && !a.target && !a.hasAttribute('download') && !a.hasAttribute('data-plain') && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) {
    const url = new URL(a.href, location.href);
    if (url.origin === location.origin && url.pathname.startsWith(BASE)) {
      e.preventDefault();
      if (url.href === location.href && !url.hash) return render();
      history.pushState(null, '', url.pathname + url.search + url.hash);
      return render();
    }
  }

  // 글 카드 빈 곳을 누르면 그 글로
  const card = t.closest('article.post[data-href]');
  if (card && !card.classList.contains('post-big') && !t.closest('a, button, details, summary, input, textarea, select, label, form') && !getSelection().toString()) {
    history.pushState(null, '', card.dataset.href);
    render();
  }
});

window.addEventListener('popstate', render);

// ---------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------
async function start() {
  if (!CONFIGURED) { drawNav(); return setupNeeded(); }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  await loadMe().catch(() => {});
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') { state.me = null; drawNav(); }
  });
  await render();
  setInterval(() => { if (!document.hidden) refreshBadges().catch(() => {}); }, 30000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
