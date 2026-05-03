/* ========================================
   main.js — portfolio site
   ======================================== */

'use strict';

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

  filterBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      // Update active state
      filterBtns.forEach(function(b) { b.classList.remove('active'); });
      this.classList.add('active');

      var genre = this.dataset.genre;

      demoCards.forEach(function(card) {
        if (genre === 'all' || card.dataset.genre === genre) {
          card.classList.remove('hidden');
          // re-trigger reveal animation
          card.classList.remove('visible');
          void card.offsetWidth; // reflow
          card.classList.add('visible');
        } else {
          card.classList.add('hidden');
        }
      });
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
   Card hover glow effect
   ---------------------------------- */
(function() {
  var cards = document.querySelectorAll('.demo-card');

  cards.forEach(function(card) {
    card.addEventListener('mousemove', function(e) {
      var rect = card.getBoundingClientRect();
      var x = ((e.clientX - rect.left) / rect.width) * 100;
      var y = ((e.clientY - rect.top) / rect.height) * 100;
      card.style.setProperty('--mouse-x', x + '%');
      card.style.setProperty('--mouse-y', y + '%');
    });
  });
})();

/* ----------------------------------
   Nav: shrink + active section highlight
   ---------------------------------- */
(function() {
  var nav = document.querySelector('.nav');
  if (!nav) return;

  window.addEventListener('scroll', function() {
    if (window.scrollY > 40) {
      nav.style.boxShadow = '0 2px 24px rgba(0,0,0,0.5)';
    } else {
      nav.style.boxShadow = 'none';
    }
  }, { passive: true });
})();

/* ----------------------------------
   Typewriter effect for hero eyebrow
   ---------------------------------- */
(function() {
  var el = document.querySelector('.hero-eyebrow-text');
  if (!el) return;

  var fullText = el.dataset.text || el.textContent;
  el.textContent = '';
  var i = 0;

  var timer = setInterval(function() {
    if (i < fullText.length) {
      el.textContent += fullText[i];
      i++;
    } else {
      clearInterval(timer);
    }
  }, 50);
})();

/* ----------------------------------
   Counter animation for hero stats
   ---------------------------------- */
(function() {
  var counters = document.querySelectorAll('.stat-num[data-target]');
  if (!counters.length) return;

  var animated = false;

  function animateCounters() {
    if (animated) return;
    animated = true;

    counters.forEach(function(el) {
      var target = parseInt(el.dataset.target, 10);
      var suffix = el.dataset.suffix || '';
      var duration = 1200;
      var start = performance.now();

      function step(now) {
        var elapsed = now - start;
        var progress = Math.min(elapsed / duration, 1);
        // ease-out
        var ease = 1 - Math.pow(1 - progress, 3);
        var value = Math.round(ease * target);
        el.textContent = value + suffix;
        if (progress < 1) {
          requestAnimationFrame(step);
        }
      }
      requestAnimationFrame(step);
    });
  }

  var heroStats = document.querySelector('.hero-stats');
  if (!heroStats) return;

  var io = new IntersectionObserver(function(entries) {
    if (entries[0].isIntersecting) {
      animateCounters();
      io.disconnect();
    }
  }, { threshold: 0.3 });

  io.observe(heroStats);
})();
