(() => {
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const post = (url, body = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': csrf },
      body: new URLSearchParams(body),
      credentials: 'same-origin',
    });
  const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(n));

  // 좋아요 (새로고침 없이)
  async function like(form, force) {
    const btn = form.querySelector('.spark');
    const res = await post(form.action, force ? { force: '1' } : {});
    if (res.status === 401) return (location.href = '/login?next=' + encodeURIComponent(location.pathname));
    if (!res.ok) return;
    const { on, count } = await res.json();
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop');
    btn.querySelector('.spark-n').textContent = fmt(count);
  }

  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (f.matches('.like-form')) { e.preventDefault(); like(f); return; }
    if (f.dataset.confirm && !confirm(f.dataset.confirm)) e.preventDefault();
  });

  // 사진 넘기기 표시 + 더블탭 좋아요
  document.querySelectorAll('.photo').forEach((ph) => {
    const slides = ph.querySelector('.slides');
    const pips = ph.querySelectorAll('.pips span');
    const pg = ph.querySelector('.pg');
    slides.addEventListener('scroll', () => {
      const i = Math.round(slides.scrollLeft / slides.clientWidth);
      pips.forEach((d, j) => d.classList.toggle('on', i === j));
      if (pg) pg.textContent = `${i + 1} / ${pips.length}`;
    }, { passive: true });
    ph.addEventListener('dblclick', () => {
      const form = ph.closest('.snap')?.querySelector('.like-form');
      if (!form) return;
      const b = ph.querySelector('.burst');
      b.classList.remove('go'); void b.offsetWidth; b.classList.add('go');
      like(form, true);
    });
  });

  // 팔로우 (새로고침 없이)
  document.querySelectorAll('.follow-form').forEach((f) => {
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await post(f.action);
      if (!res.ok) return f.submit();
      const { following, followers } = await res.json();
      const b = f.querySelector('button');
      b.textContent = following ? '✓ 팔로잉' : '＋ 팔로우';
      b.classList.toggle('btn-lime', !following);
      const fc = document.querySelector('.follower-count');
      if (fc) fc.textContent = fmt(followers);
    });
  });

  // 업로드 미리보기
  document.querySelectorAll('input[type=file][data-preview]').forEach((input) => {
    const box = document.querySelector(input.dataset.preview);
    input.addEventListener('change', () => {
      box.replaceChildren(...[...input.files].slice(0, 10).map((f) => {
        const img = new Image();
        img.src = URL.createObjectURL(f);
        img.alt = f.name;
        return img;
      }));
    });
  });
  document.querySelectorAll('input[type=file][data-avatar-preview]').forEach((input) => {
    const img = document.querySelector(input.dataset.avatarPreview);
    input.addEventListener('change', () => { if (input.files[0]) img.src = URL.createObjectURL(input.files[0]); });
  });

  document.querySelectorAll('[data-back]').forEach((a) =>
    a.addEventListener('click', (e) => { if (history.length > 1) { e.preventDefault(); history.back(); } })
  );

  // ===== 스토리 플레이어 =====
  const stage = document.querySelector('.story-stage');
  if (stage) {
    const items = [...stage.querySelectorAll('.story')];
    const bars = [...stage.querySelectorAll('.story-bars i')];
    const timeEl = stage.querySelector('.story-time');
    const pauseBtn = stage.querySelector('.story-pause');
    const DURATION = 5000;
    let i = Number(stage.dataset.start) || 0;
    let elapsed = 0, last = 0, paused = false, raf = 0;
    const seen = new Set();

    const finish = () => { location.href = stage.dataset.next || '/snap'; };
    function show(n) {
      if (n < 0) n = 0;
      if (n >= items.length) return finish();
      i = n; elapsed = 0;
      items.forEach((el, k) => el.classList.toggle('on', k === i));
      bars.forEach((b, k) => { b.style.width = k < i ? '100%' : '0%'; });
      const it = items[i];
      timeEl.textContent = '· ' + it.dataset.ago;
      if (!seen.has(it.dataset.id)) { seen.add(it.dataset.id); post('/stories/' + it.dataset.id + '/seen').catch(() => {}); }
    }
    function tick(t) {
      if (!last) last = t;
      if (!paused) elapsed += t - last;
      last = t;
      bars[i].style.width = Math.min(100, (elapsed / DURATION) * 100) + '%';
      if (elapsed >= DURATION) show(i + 1);
      raf = requestAnimationFrame(tick);
    }
    const setPaused = (p) => { paused = p; stage.classList.toggle('paused', p); pauseBtn.textContent = p ? '▶' : '❚❚'; };
    stage.querySelector('.story-tap.prev').addEventListener('click', (e) => { e.preventDefault(); show(i - 1); });
    stage.querySelector('.story-tap.next').addEventListener('click', (e) => { e.preventDefault(); show(i + 1); });
    pauseBtn.addEventListener('click', () => setPaused(!paused));
    stage.querySelectorAll('.story-owner details').forEach((d) => d.addEventListener('toggle', () => setPaused(d.open)));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') show(i + 1);
      else if (e.key === 'ArrowLeft') show(i - 1);
      else if (e.key === ' ') { e.preventDefault(); setPaused(!paused); }
      else if (e.key === 'Escape') location.href = '/snap';
    });
    document.addEventListener('visibilitychange', () => { last = 0; });
    show(i);
    raf = requestAnimationFrame(tick);
  }

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
