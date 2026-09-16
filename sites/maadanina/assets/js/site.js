/* מעדנינה — scroll engine.
   Two jobs: reveal things as they enter, and publish each parallax element's
   progress through the viewport as --sy (0 → 1) for CSS to consume.
   Everything reads in one rAF pass and writes transforms only. */

(() => {
  'use strict';

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------- reveals ---- */

  const revealables = document.querySelectorAll('[data-reveal], [data-letters], .rule, .intro__statement');

  if (reduced || !('IntersectionObserver' in window)) {
    revealables.forEach((el) => el.classList.add('is-in'));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('is-in');
          io.unobserve(e.target); // reveal once; never flicker on scroll-back
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.12 }
    );
    revealables.forEach((el) => io.observe(el));
  }

  /* --------------------------------------------------------- parallax ---- */

  const tracked = [...document.querySelectorAll('[data-parallax]')];
  const bar = document.querySelector('.actionbar');
  const hero = document.querySelector('.hero');

  // Only run the loop for elements actually on screen.
  const live = new Set();
  if (!reduced && 'IntersectionObserver' in window) {
    const vis = new IntersectionObserver(
      (entries) => {
        for (const e of entries) e.isIntersecting ? live.add(e.target) : live.delete(e.target);
        if (live.size) schedule();
      },
      { rootMargin: '25% 0px 25% 0px' }
    );
    tracked.forEach((el) => vis.observe(el));
  }

  let ticking = false;

  function schedule() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(frame);
  }

  function frame() {
    ticking = false;
    const vh = innerHeight;

    // Read every geometry first, then write every style. Interleaving the two
    // forces a synchronous layout per element, which is what turns a parallax
    // loop into hundreds of milliseconds of blocking time.
    const reads = [];
    for (const el of live) {
      const r = el.getBoundingClientRect();
      const total = r.height + vh;
      const p = total > 0 ? (vh - r.top) / total : 0;
      reads.push([el, Math.min(1, Math.max(0, p)).toFixed(3)]);
    }
    const heroBottom = bar && hero ? hero.getBoundingClientRect().bottom : null;

    for (const [el, value] of reads) el.style.setProperty('--sy', value);
    if (heroBottom !== null) bar.classList.toggle('is-on', heroBottom < vh * 0.55);
  }

  if (!reduced) {
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule, { passive: true });
    schedule();
  } else if (bar) {
    bar.classList.add('is-on');
  }

  /* ------------------------------------------- split text for the intro -- */
  // Done in JS so the HTML stays readable and screen readers get clean text.

  document.querySelectorAll('[data-split="word"]').forEach((el) => {
    const text = el.textContent.trim();
    el.setAttribute('aria-label', text);
    el.textContent = '';
    text.split(/\s+/).forEach((word, i) => {
      const span = document.createElement('span');
      span.className = 'w';
      span.style.setProperty('--n', i);
      span.textContent = word;
      span.setAttribute('aria-hidden', 'true');
      el.append(span, document.createTextNode(' '));
    });
  });
})();
