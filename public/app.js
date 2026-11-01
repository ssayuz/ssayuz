(() => {
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const post = (url, body = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': csrf },
      body: new URLSearchParams(body),
      credentials: 'same-origin',
    });
  const fmt = (n) => (!n ? '' : n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(n));
  const toLogin = () => (location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search));

  // 짧은 안내 메시지
  let toastEl;
  function toast(text) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.append(toastEl); }
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  // ===== 좋아요 / 리포스트 / 팔로우 (새로고침 없이) =====
  document.addEventListener('submit', async (e) => {
    const f = e.target;
    if (f.dataset.confirm && !confirm(f.dataset.confirm)) { e.preventDefault(); return; }
    if (f.matches('.like-form')) {
      e.preventDefault();
      const btn = f.querySelector('.like');
      const res = await post(f.action);
      if (res.status === 401) return toLogin();
      if (!res.ok) return;
      const { on, count } = await res.json();
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
      btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop');
      btn.querySelector('.n').textContent = fmt(count);
    } else if (f.matches('.repost-form')) {
      e.preventDefault();
      const menu = f.closest('details');
      const res = await post(f.action);
      if (res.status === 401) return toLogin();
      if (!res.ok) return;
      const { on, count } = await res.json();
      const sum = menu.querySelector('summary');
      sum.classList.toggle('on-repost', on);
      sum.querySelector('.n').textContent = fmt(count);
      f.querySelector('.repost-label').textContent = on ? '리포스트 취소' : '리포스트';
      menu.open = false;
      toast(on ? '리포스트했어요' : '리포스트를 취소했어요');
    } else if (f.matches('.follow-form')) {
      e.preventDefault();
      const b = f.querySelector('button');
      const res = await post(f.action);
      if (res.status === 401) return toLogin();
      if (!res.ok) return;
      const { following, followers } = await res.json();
      b.textContent = following ? '팔로잉' : '팔로우';
      b.classList.toggle('btn-ink', !following && b.classList.contains('btn-block'));
      const fc = document.querySelector('.follower-count');
      if (fc && document.querySelector('.profile')) fc.textContent = fmt(followers) || '0';
    }
  });

  // ===== 링크 복사 =====
  document.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]');
    if (!c) return;
    e.preventDefault();
    const url = c.dataset.copy;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ url });
      else { await navigator.clipboard.writeText(url); toast('링크를 복사했어요'); }
    } catch { /* 취소 */ }
    c.closest('details')?.removeAttribute('open');
  });

  // 열린 메뉴는 바깥을 누르면 닫기
  document.addEventListener('click', (e) => {
    document.querySelectorAll('details.menu[open]').forEach((d) => { if (!d.contains(e.target)) d.removeAttribute('open'); });
  });

  // ===== 글 카드 아무 곳이나 누르면 글로 이동 =====
  document.addEventListener('click', (e) => {
    const card = e.target.closest('article.post[data-href]');
    if (!card || card.classList.contains('post-big')) return;
    if (e.target.closest('a, button, form, details, summary, input, textarea, select, label')) return;
    if (getSelection().toString()) return;
    location.href = card.dataset.href;
  });

  // ===== 글쓰기 =====
  document.querySelectorAll('form.composer').forEach((form) => {
    const max = Number(form.dataset.max) || 500;
    const maxParts = Number(form.dataset.maxParts) || 10;
    const parts = form.querySelector('.parts');
    const addBtn = form.querySelector('.add-part');
    const submit = form.querySelector('.post-btn');
    const len = (s) => Array.from(s).length;

    function fit(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
    function refresh() {
      let any = false, over = false;
      parts.querySelectorAll('.part').forEach((p) => {
        const ta = p.querySelector('textarea');
        const n = len(ta.value.trim());
        const cnt = p.querySelector('.count');
        const left = max - len(ta.value);
        cnt.textContent = left <= 50 ? String(left) : '';
        cnt.classList.toggle('warn', left < 0);
        if (n) any = true;
        if (left < 0) over = true;
      });
      submit.disabled = !any || over;
      addBtn.hidden = parts.children.length >= maxParts;
    }
    function wire(p) {
      const ta = p.querySelector('textarea');
      ta.addEventListener('input', () => { fit(ta); refresh(); });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !submit.disabled) { e.preventDefault(); form.requestSubmit(); }
      });
      p.querySelector('.part-remove')?.addEventListener('click', () => { p.remove(); refresh(); });
      fit(ta);
    }
    parts.querySelectorAll('.part').forEach(wire);
    addBtn.addEventListener('click', () => {
      const first = parts.querySelector('.part');
      const p = first.cloneNode(true);
      const ta = p.querySelector('textarea');
      ta.value = '';
      ta.placeholder = '이어서 쓰기...';
      const head = p.querySelector('.part-head');
      head.querySelector('.part-remove')?.remove();
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'linkbtn tiny part-remove'; rm.textContent = '빼기';
      head.append(rm);
      parts.append(p);
      wire(p);
      refresh();
      ta.focus();
    });
    form.addEventListener('submit', () => { submit.disabled = true; });
    refresh();
  });

  // 방금 쓴 답글로 스크롤 + 강조
  if (location.hash.startsWith('#post-')) document.querySelector(location.hash)?.classList.add('flash');

  document.querySelectorAll('[data-back]').forEach((a) =>
    a.addEventListener('click', (e) => { if (history.length > 1) { e.preventDefault(); history.back(); } })
  );

  // ===== DM 채팅 =====
  const chat = document.querySelector('.chat');
  if (chat) {
    const log = chat.querySelector('#chat-log');
    const form = chat.querySelector('.chat-form');
    const me = Number(chat.dataset.me);
    const partner = chat.dataset.partner;
    const pad = (n) => String(n).padStart(2, '0');
    const hhmm = (ts) => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
    const lastId = () => Math.max(0, ...[...log.querySelectorAll('.msg')].map((m) => Number(m.dataset.id)));
    const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    const toBottom = () => { log.scrollTop = log.scrollHeight; };

    function add(m) {
      if (log.querySelector(`.msg[data-id="${m.id}"]`)) return;
      log.querySelector('.chat-empty')?.remove();
      const el = document.createElement('div');
      el.className = 'msg ' + (m.sender_id === me ? 'mine' : 'theirs');
      el.dataset.id = m.id;
      const body = document.createElement('div');
      body.className = 'msg-body';
      body.textContent = m.body;
      const meta = document.createElement('div');
      meta.className = 'msg-meta';
      meta.textContent = hhmm(m.created_at) + ' ';
      if (m.sender_id === me) { const r = document.createElement('span'); r.className = 'msg-read'; meta.append(r); }
      el.append(body, meta);
      log.insertBefore(el, log.querySelector('#end'));
    }
    function markRead(upTo) {
      log.querySelectorAll('.msg.mine').forEach((m) => {
        const r = m.querySelector('.msg-read');
        if (r && Number(m.dataset.id) <= upTo) r.textContent = '읽음';
      });
    }
    async function poll() {
      try {
        const res = await fetch(`/dm/@${encodeURIComponent(partner)}/poll?after=${lastId()}`, { credentials: 'same-origin' });
        if (!res.ok) return;
        const { messages, readUpTo } = await res.json();
        const stick = atBottom();
        messages.forEach(add);
        markRead(readUpTo);
        if (messages.length && stick) toBottom();
      } catch {}
    }
    if (form) {
      const ta = form.querySelector('textarea');
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
      });
      ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = ta.value.trim();
        if (!text) return;
        const btn = form.querySelector('button');
        btn.disabled = true;
        try {
          const res = await post(form.action, { body: text });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.message) { add(data.message); ta.value = ''; ta.style.height = ''; toBottom(); }
          else alert(data.error || '보내지 못했어요.');
        } finally { btn.disabled = false; ta.focus(); }
      });
    }
    toBottom();
    setInterval(() => { if (!document.hidden) poll(); }, 3000);
    poll();
  }
})();
