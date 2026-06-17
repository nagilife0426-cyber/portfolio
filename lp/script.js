'use strict';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isTouch = window.matchMedia('(hover: none), (pointer: coarse)').matches;
const lerp = (a, b, n) => a + (b - a) * n;

/* ============================================================
   Preloader → hero reveal
   ============================================================ */
(function preloader() {
  const loader = document.getElementById('loader');
  const numEl = document.querySelector('[data-loadnum]');
  const bar = document.querySelector('.loader__bar span');

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (numEl) numEl.textContent = '100';
    if (bar) bar.style.width = '100%';
    document.body.removeAttribute('data-loading');
    document.body.classList.add('is-revealed');
    if (loader) {
      loader.classList.add('is-done');
      setTimeout(() => loader.remove(), 700);
    }
  };

  // hard failsafe: never trap the user behind the loader
  setTimeout(finish, 3200);
  window.addEventListener('load', () => setTimeout(finish, 600));

  if (reduceMotion || !loader) { finish(); return; }

  let p = 0;
  const tick = () => {
    if (finished) return;
    p += Math.max(1, (100 - p) * 0.12);
    if (p >= 100) p = 100;
    const v = Math.floor(p);
    if (numEl) numEl.textContent = v;
    if (bar) bar.style.width = v + '%';
    if (p < 100) {
      setTimeout(tick, 90 + Math.random() * 70);
    } else {
      setTimeout(finish, 360);
    }
  };
  // kick after fonts settle a touch
  setTimeout(tick, 180);
})();

/* ============================================================
   Custom cursor + magnetic
   ============================================================ */
(function cursor() {
  if (reduceMotion || isTouch) return;
  const cur = document.querySelector('.cursor');
  const dot = document.querySelector('.cursor__dot');
  const ring = document.querySelector('.cursor__ring');
  if (!cur) return;

  let mx = window.innerWidth / 2, my = window.innerHeight / 2;
  let rx = mx, ry = my;

  window.addEventListener('mousemove', (e) => {
    mx = e.clientX; my = e.clientY;
    dot.style.left = mx + 'px'; dot.style.top = my + 'px';
  });
  window.addEventListener('mousedown', () => cur.classList.add('is-down'));
  window.addEventListener('mouseup', () => cur.classList.remove('is-down'));

  const render = () => {
    rx = lerp(rx, mx, 0.16); ry = lerp(ry, my, 0.16);
    ring.style.left = rx + 'px'; ring.style.top = ry + 'px';
    requestAnimationFrame(render);
  };
  render();

  document.querySelectorAll('[data-cursor], a, button, summary').forEach((el) => {
    el.addEventListener('mouseenter', () => cur.classList.add('is-hover'));
    el.addEventListener('mouseleave', () => cur.classList.remove('is-hover'));
  });

  // magnetic
  document.querySelectorAll('.magnetic').forEach((el) => {
    const strength = 0.32;
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - (r.left + r.width / 2)) * strength;
      const y = (e.clientY - (r.top + r.height / 2)) * strength;
      el.style.transform = `translate(${x}px, ${y}px)`;
    });
    el.addEventListener('mouseleave', () => { el.style.transform = ''; });
  });
})();

/* ============================================================
   Reveal on scroll (IntersectionObserver)
   ============================================================ */
(function reveals() {
  const els = document.querySelectorAll('.reveal');
  if (reduceMotion) { els.forEach((el) => el.classList.add('is-in')); return; }

  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const siblings = entry.target.parentElement
        ? [...entry.target.parentElement.querySelectorAll(':scope > .reveal')]
        : [entry.target];
      const idx = Math.max(0, siblings.indexOf(entry.target));
      entry.target.style.transitionDelay = (idx % 6) * 0.07 + 's';
      entry.target.classList.add('is-in');
      obs.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -7% 0px' });

  els.forEach((el) => io.observe(el));

  // contact title line reveal
  const ct = document.querySelector('.contact__title');
  if (ct) {
    const cio = new IntersectionObserver((entries, obs) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); obs.unobserve(e.target); } });
    }, { threshold: 0.4 });
    cio.observe(ct);
  }
})();

/* ============================================================
   Stat count-up
   ============================================================ */
(function counts() {
  const nums = document.querySelectorAll('.stat__num');
  const run = (el) => {
    const target = parseInt(el.dataset.count, 10);
    const suffix = el.dataset.suffix || '';
    if (reduceMotion) { el.textContent = target + suffix; return; }
    const dur = 1500; const start = performance.now();
    let done = false;
    const settle = () => { if (!done) { done = true; el.textContent = target + suffix; } };
    const step = (now) => {
      if (done) return;
      const t = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(target * eased) + suffix;
      if (t < 1) requestAnimationFrame(step); else settle();
    };
    requestAnimationFrame(step);
    // guarantee final value even if rAF is throttled in background tabs
    setTimeout(settle, dur + 120);
  };
  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach((e) => { if (e.isIntersecting) { run(e.target); obs.unobserve(e.target); } });
  }, { threshold: 0.6 });
  nums.forEach((el) => io.observe(el));
})();

/* ============================================================
   Header: hide on scroll-down, show on up + stuck bg
   ============================================================ */
(function header() {
  const h = document.getElementById('header');
  if (!h) return;
  let last = 0;
  const onScroll = () => {
    const y = window.scrollY;
    h.classList.toggle('is-stuck', y > 40);
    if (y > last && y > 400) h.classList.add('is-hidden');
    else h.classList.remove('is-hidden');
    last = y;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

/* ============================================================
   Scroll progress
   ============================================================ */
(function progress() {
  const bar = document.querySelector('.scroll-progress span');
  if (!bar) return;
  const onScroll = () => {
    const h = document.documentElement;
    const max = h.scrollHeight - h.clientHeight;
    const p = max > 0 ? (h.scrollTop / max) : 0;
    bar.style.transform = `scaleX(${p})`;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

/* ============================================================
   Parallax (data-parallax = factor)
   ============================================================ */
(function parallax() {
  if (reduceMotion) return;
  const els = [...document.querySelectorAll('[data-parallax]')];
  if (!els.length) return;
  let ticking = false;
  const update = () => {
    const vh = window.innerHeight;
    els.forEach((el) => {
      const r = el.getBoundingClientRect();
      const center = r.top + r.height / 2 - vh / 2;
      const f = parseFloat(el.dataset.parallax) || 0.1;
      el.style.transform = `translate3d(0, ${(-center * f).toFixed(1)}px, 0)`;
    });
    ticking = false;
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  }, { passive: true });
  update();
})();

/* ============================================================
   FAQ — single-open accordion
   ============================================================ */
(function faq() {
  const items = document.querySelectorAll('.faq__item');
  items.forEach((item) => {
    item.querySelector('.faq__q').addEventListener('click', () => {
      if (!item.open) items.forEach((o) => { if (o !== item) o.open = false; });
    });
  });
})();

/* ============================================================
   Smooth anchor
   ============================================================ */
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    if (id.length > 1) {
      const t = document.querySelector(id);
      if (t) { e.preventDefault(); t.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); }
    }
  });
});
