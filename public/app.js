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
})();
