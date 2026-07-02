/* ========================================
   main.js — portfolio site
   ======================================== */

'use strict';

/* JSが動く環境でだけ reveal の初期非表示を有効化（no-JS環境の白画面防止） */
document.documentElement.classList.add('js');

/* ----------------------------------
   Smooth scroll for anchor links
   ---------------------------------- */
document.querySelectorAll('a[href^="#"]').forEach(function(anchor) {
  anchor.addEventListener('click', function(e) {
    var target = document.querySelector(this.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    var offset = 72; // nav height
    var top = target.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({ top: top, behavior: 'smooth' });
  });
});

/* ----------------------------------
   Genre filter for demo cards
   ---------------------------------- */
(function() {
  var filterBtns = document.querySelectorAll('.filter-btn');
  var demoCards  = document.querySelectorAll('.demo-card');
  var status     = document.getElementById('filter-status');

  // initial aria state
  filterBtns.forEach(function(b) {
    b.setAttribute('aria-pressed', b.classList.contains('active') ? 'true' : 'false');
  });

  filterBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      // Update active state
      filterBtns.forEach(function(b) {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      this.classList.add('active');
      this.setAttribute('aria-pressed', 'true');

      var genre = this.dataset.genre;
      var shown = 0;

      demoCards.forEach(function(card) {
        // a card can carry multiple space-separated genres (e.g. "AI LP")
        var genres = (card.dataset.genre || '').split(' ');
        if (genre === 'all' || genres.indexOf(genre) !== -1) {
          card.classList.remove('hidden');
          shown++;
          // re-trigger reveal animation
          card.classList.remove('visible');
          void card.offsetWidth; // reflow
          card.classList.add('visible');
        } else {
          card.classList.add('hidden');
        }
      });

      if (status) {
        status.textContent = (genre === 'all' ? 'すべて' : this.textContent) +
          'を表示中：' + shown + ' 件';
      }
    });
  });
})();

/* ----------------------------------
   Scroll reveal (IntersectionObserver)
   ---------------------------------- */
(function() {
  var reveals = document.querySelectorAll('.reveal');

  if (!('IntersectionObserver' in window)) {
    reveals.forEach(function(el) { el.classList.add('visible'); });
    return;
  }

  var io = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });

  reveals.forEach(function(el) { io.observe(el); });
})();

/* ----------------------------------
   Counter animation — 署名モーメントは「39」1点のみ。
   静的HTMLに最終値が入っているため、動かさない場合は一切触らない。
   prefers-reduced-motion 時はアニメ自体を行わない。
   ---------------------------------- */
(function() {
  var counter = document.querySelector('.stat-num[data-target="39"]');
  if (!counter) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var animated = false;

  function animateCounter() {
    if (animated) return;
    animated = true;

    var target = parseInt(counter.dataset.target, 10);
    var suffix = counter.dataset.suffix || '';
    var duration = 1200;
    var start = performance.now();

    function step(now) {
      var elapsed = now - start;
      var progress = Math.min(elapsed / duration, 1);
      // ease-out
      var ease = 1 - Math.pow(1 - progress, 3);
      counter.textContent = Math.round(ease * target) + suffix;
      if (progress < 1) {
        requestAnimationFrame(step);
      }
    }
    requestAnimationFrame(step);
  }

  var heroStats = document.querySelector('.hero-stats');
  if (!heroStats) return;

  var io = new IntersectionObserver(function(entries) {
    if (entries[0].isIntersecting) {
      animateCounter();
      io.disconnect();
    }
  }, { threshold: 0.3 });

  io.observe(heroStats);
})();
