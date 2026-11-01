(() => {
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const post = (url, body = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': csrf },
      body: new URLSearchParams(body),
      credentials: 'same-origin',
    });

  // 좋아요 (새로고침 없이)
  async function like(form, force) {
    const btn = form.querySelector('.like');
    const res = await post(form.action, force ? { force: 'like' } : {});
    if (res.status === 401) return (location.href = '/login?next=' + encodeURIComponent(location.pathname));
    if (!res.ok) return;
    const { liked, count } = await res.json();
    btn.classList.toggle('on', liked);
    btn.setAttribute('aria-pressed', String(liked));
    btn.classList.remove('bump'); void btn.offsetWidth; btn.classList.add('bump');
    const c = form.closest('.post')?.querySelector('.like-count');
    if (c) c.textContent = count.toLocaleString('ko-KR');
  }
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (f.matches('.like-form')) { e.preventDefault(); like(f); return; }
    if (f.dataset.confirm && !confirm(f.dataset.confirm)) e.preventDefault();
  });

  // 더블탭 좋아요 + 캐러셀 점
  document.querySelectorAll('.carousel').forEach((car) => {
    const slides = car.querySelector('.slides');
    const dots = car.querySelectorAll('.dots span');
    const badge = car.querySelector('.count-badge');
    slides.addEventListener('scroll', () => {
      const i = Math.round(slides.scrollLeft / slides.clientWidth);
      dots.forEach((d, j) => d.classList.toggle('on', i === j));
      if (badge) badge.textContent = `${i + 1}/${dots.length}`;
    }, { passive: true });
    car.addEventListener('dblclick', () => {
      const form = car.closest('.post')?.querySelector('.like-form');
      if (!form) return;
      const pop = car.querySelector('.heart-pop');
      pop.classList.remove('go'); void pop.offsetWidth; pop.classList.add('go');
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
      b.textContent = following ? '팔로잉' : '팔로우';
      b.classList.toggle('btn-primary', !following);
      b.classList.toggle('btn-ghost', following);
      const fc = document.querySelector('.follower-count');
      if (fc) fc.textContent = followers.toLocaleString('ko-KR');
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
