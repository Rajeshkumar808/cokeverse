/* ==========================================================================
   POUR — cinematic landing page engine
   Sections:
     1. Config & frame manifest
     2. Loader / preloader
     3. Canvas animation engine (rAF-driven, frame-accurate)
     4. Hero canvas resize / aspect handling
     5. Custom cursor + mouse glow + parallax
     6. Navbar (solid-on-scroll, active link, mobile toggle)
     7. Scroll effects (hero fade/scale, section reveals, counters)
     8. Gallery mini-canvases (static frame thumbnails)
     9. Watch Film modal-lite (scrubs through frames in a burst)
   ========================================================================== */

(() => {
  'use strict';

  /* ---------------------------------------------------------------------
     1. CONFIG
  --------------------------------------------------------------------- */
  const FRAME_COUNT   = 51;                 // total frames exported from the source clip
  const FRAME_FOLDER  = 'frames';
  const FRAME_PREFIX  = 'frame_';
  const FRAME_PAD     = 3;                  // frame_000.jpg ... frame_050.jpg
  const FRAME_EXT     = '.jpg';
  const TARGET_FPS    = 60;
  const NATIVE_FRAME_RATE = 30;             // the source clip's natural frame rate
  // We play back at TARGET_FPS but only advance the *source* frame at
  // NATIVE_FRAME_RATE, so motion speed matches the original footage while
  // the render loop itself stays buttery at 60fps (no judder, no skipped paints).
  const MS_PER_SOURCE_FRAME = 1000 / NATIVE_FRAME_RATE;

  const frameUrl = (i) => `${FRAME_FOLDER}/${FRAME_PREFIX}${String(i).padStart(FRAME_PAD, '0')}${FRAME_EXT}`;

  const state = {
    images: [],
    loadedCount: 0,
    ready: false,
    currentFrame: 0,
    lastFrameTime: 0,
    rafId: null,
    reduceMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };

  /* ---------------------------------------------------------------------
     2. PRELOADER
  --------------------------------------------------------------------- */
  const loaderEl    = document.getElementById('loader');
  const loaderBar   = document.getElementById('loader-bar');
  const loaderPct   = document.getElementById('loader-pct');
  const loaderStatus= document.getElementById('loader-status');

  function preloadFrames() {
    return new Promise((resolve) => {
      let settled = 0;

      const onOneSettled = () => {
        settled += 1;
        state.loadedCount = settled;
        const pct = Math.round((settled / FRAME_COUNT) * 100);
        loaderBar.style.width = pct + '%';
        loaderPct.textContent = pct + '%';
        if (settled === FRAME_COUNT) resolve();
      };

      for (let i = 0; i < FRAME_COUNT; i++) {
        const img = new Image();
        img.decoding = 'async';
        img.onload  = onOneSettled;
        img.onerror = onOneSettled; // never block the experience on one bad frame
        img.src = frameUrl(i);
        state.images[i] = img;
      }
    });
  }

  function hideLoader() {
    loaderStatus.textContent = 'Ready';
    loaderEl.classList.add('is-hidden');
    document.body.style.overflow = '';
    setTimeout(() => { loaderEl.style.display = 'none'; }, 850);
  }

  /* ---------------------------------------------------------------------
     3. CANVAS ANIMATION ENGINE
  --------------------------------------------------------------------- */
  const canvas = document.getElementById('hero-canvas');
  const ctx    = canvas.getContext('2d', { alpha: false });

  // Internal render resolution stays fixed to the source asset for crisp,
  // consistent drawImage cost regardless of CSS display size (object-fit:
  // contain handles the visual scaling on the GPU compositor, not canvas).
  const SOURCE_W = 1280;
  const SOURCE_H = 720;
  canvas.width  = SOURCE_W;
  canvas.height = SOURCE_H;

  function drawFrame(index) {
    const img = state.images[index];
    if (!img || !img.complete || img.naturalWidth === 0) return;
    // Full clear avoids any ghosting/flicker between frames of differing content.
    ctx.clearRect(0, 0, SOURCE_W, SOURCE_H);
    ctx.drawImage(img, 0, 0, SOURCE_W, SOURCE_H);
  }

  function tick(timestamp) {
    state.rafId = requestAnimationFrame(tick);

    if (state.lastFrameTime === 0) state.lastFrameTime = timestamp;
    const elapsed = timestamp - state.lastFrameTime;

    // Advance the source frame only when enough time has passed for the
    // *content* frame rate — this decouples render rate (60fps, smooth)
    // from content rate (natural clip speed), preventing both judder and
    // an unnaturally fast loop.
    if (elapsed >= MS_PER_SOURCE_FRAME) {
      const framesToAdvance = Math.floor(elapsed / MS_PER_SOURCE_FRAME);
      state.currentFrame = (state.currentFrame + framesToAdvance) % FRAME_COUNT;
      state.lastFrameTime = timestamp - (elapsed % MS_PER_SOURCE_FRAME);
      drawFrame(state.currentFrame);
    }
  }

  function startAnimation() {
    if (state.rafId) return;
    state.lastFrameTime = 0;
    state.rafId = requestAnimationFrame(tick);
  }

  function stopAnimation() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
  }

  // Pause rendering when the tab is hidden — saves battery/CPU and avoids
  // a huge elapsed-time jump (which would otherwise skip many frames at once).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopAnimation();
    else if (state.ready) startAnimation();
  });

  /* ---------------------------------------------------------------------
     4. HERO STAGE — keep 16:9 centered & fully visible at any viewport
  --------------------------------------------------------------------- */
  // Aspect ratio is enforced purely in CSS (aspect-ratio:16/9 on .hero-stage),
  // so no JS resize handler is needed for layout. We still guard against
  // extremely short viewports (e.g. landscape phones) by capping stage height.
  const heroStage = document.getElementById('heroStage');
  function clampStageHeight() {
    const vh = window.innerHeight;
    const maxHeightPx = vh * 0.86;
    heroStage.style.maxHeight = maxHeightPx + 'px';
  }
  window.addEventListener('resize', clampStageHeight, { passive: true });
  clampStageHeight();

  /* ---------------------------------------------------------------------
     5. CUSTOM CURSOR + MOUSE GLOW + PARALLAX
  --------------------------------------------------------------------- */
  const cursorDot  = document.getElementById('cursorDot');
  const cursorRing = document.getElementById('cursorRing');
  const mouseGlow  = document.getElementById('mouseGlow');
  const isFinePointer = window.matchMedia('(pointer: fine)').matches;

  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let ringX = mouseX, ringY = mouseY;
  let glowX = mouseX, glowY = mouseY;
  let parallaxX = 0, parallaxY = 0; // hero-stage drift, updated by the mousemove listener below

  if (isFinePointer) {
    window.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      cursorDot.style.transform = `translate(${mouseX}px, ${mouseY}px) translate(-50%,-50%)`;
    }, { passive: true });

    document.querySelectorAll('[data-cursor-hover], .btn, a, button').forEach((el) => {
      el.addEventListener('mouseenter', () => cursorRing.classList.add('is-active'));
      el.addEventListener('mouseleave', () => cursorRing.classList.remove('is-active'));
    });

    function animateCursorFollowers() {
      // Smooth lerp for the ring (slight lag = premium feel) and the glow (slower, ambient).
      ringX += (mouseX - ringX) * 0.18;
      ringY += (mouseY - ringY) * 0.18;
      glowX += (mouseX - glowX) * 0.07;
      glowY += (mouseY - glowY) * 0.07;

      cursorRing.style.transform = `translate(${ringX}px, ${ringY}px) translate(-50%,-50%)`;
      mouseGlow.style.transform  = `translate(${glowX}px, ${glowY}px) translate(-50%,-50%)`;

      requestAnimationFrame(animateCursorFollowers);
    }
    requestAnimationFrame(animateCursorFollowers);
  } else {
    mouseGlow.style.display = 'none';
  }

  // Subtle parallax: hero stage drifts opposite the cursor, very gently.
  // Values are kept in plain JS vars (parallaxX/Y, declared above with the
  // other cursor-tracking variables) and read directly inside
  // applyHeroTransform — no CSS custom-property round trip, no forced
  // getComputedStyle reflow on every mousemove.
  if (isFinePointer && !state.reduceMotion) {
    window.addEventListener('mousemove', (e) => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const dx = (e.clientX - cx) / cx;   // -1..1
      const dy = (e.clientY - cy) / cy;   // -1..1
      parallaxX = dx * 10;
      parallaxY = dy * 6;
      applyHeroTransform();
    }, { passive: true });
  }

  /* ---------------------------------------------------------------------
     6. NAVBAR
  --------------------------------------------------------------------- */
  const navbar    = document.getElementById('navbar');
  const navLinks  = document.getElementById('navLinks');
  const navToggle = document.getElementById('navToggle');
  const navAnchors = document.querySelectorAll('.nav-link');
  const sections   = document.querySelectorAll('section[id]');

  function updateNavbarSolid() {
    navbar.classList.toggle('is-solid', window.scrollY > 40);
  }

  function updateActiveLink() {
    let activeId = null;
    const probeline = window.scrollY + window.innerHeight * 0.35;
    sections.forEach((sec) => {
      if (sec.offsetTop <= probeline) activeId = sec.id;
    });
    navAnchors.forEach((a) => {
      a.classList.toggle('is-active', a.getAttribute('href') === '#' + activeId);
    });
  }

  navToggle.addEventListener('click', () => {
    const open = navLinks.classList.toggle('is-open');
    navToggle.classList.toggle('is-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
  });

  navAnchors.forEach((a) => {
    a.addEventListener('click', () => {
      navLinks.classList.remove('is-open');
      navToggle.classList.remove('is-open');
    });
  });

  /* ---------------------------------------------------------------------
     7. SCROLL EFFECTS — hero fade/scale + section reveals + counters
  --------------------------------------------------------------------- */
  const heroContent = document.getElementById('heroContent');
  const heroBg       = document.querySelector('.hero-bg');

  function applyHeroTransform() {
    const scrollY = window.scrollY;
    const vh = window.innerHeight;
    const progress = Math.min(scrollY / (vh * 0.9), 1); // 0 -> 1 across first ~viewport of scroll

    // Content fades upward and out.
    heroContent.style.opacity   = String(1 - progress);
    heroContent.style.transform = `translateY(${-progress * 60}px)`;

    // Stage scales slightly as you scroll, plus the cursor-parallax drift
    // (parallaxX/Y are plain JS numbers updated directly by the mousemove
    // listener in section 5 — no style read-back needed).
    const scale = 1 + progress * 0.06;
    heroStage.style.transform = `scale(${scale}) translate(${parallaxX}px, ${parallaxY}px)`;

    // Background lighting subtly intensifies/dims with scroll.
    if (heroBg) heroBg.style.opacity = String(1 - progress * 0.4);
  }

  // IntersectionObserver-driven reveals (fade + translate-up), runs once per element.
  const revealEls = document.querySelectorAll('.reveal');
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.18, rootMargin: '0px 0px -40px 0px' });
  revealEls.forEach((el) => revealObserver.observe(el));

  // Animated number counters for the Performance stat cards — triggers once,
  // when the card scrolls into view.
  const counterEls = document.querySelectorAll('[data-count]');
  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      counterObserver.unobserve(entry.target);
      const el = entry.target;
      const target = parseFloat(el.getAttribute('data-count'));
      const isDecimal = String(target).includes('.');
      // The numeric value lives in the card's leading text node; the
      // trailing <span class="stat-unit"> is a separate child and is
      // never touched, so updating firstChild.textContent is safe.
      const textNode = el.firstChild;
      const duration = 1400;
      const startTime = performance.now();

      function step(now) {
        const t = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
        const current = target * eased;
        textNode.textContent = isDecimal ? current.toFixed(1) : Math.round(current).toLocaleString();
        if (t < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }, { threshold: 0.4 });
  counterEls.forEach((el) => counterObserver.observe(el));

  let scrollTicking = false;
  function onScroll() {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      updateNavbarSolid();
      updateActiveLink();
      applyHeroTransform();
      scrollTicking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------------------------------------------------------------------
     8. GALLERY MINI-CANVASES — draw a static, representative frame
        from the same preloaded image set (zero extra network requests).
  --------------------------------------------------------------------- */
  function paintGalleryCanvases() {
    document.querySelectorAll('.gallery-card').forEach((card) => {
      const frameIndex = Math.min(parseInt(card.dataset.frame, 10) || 0, FRAME_COUNT - 1);
      const img = state.images[frameIndex];
      const cv = card.querySelector('canvas');
      if (!cv || !img) return;
      cv.width = SOURCE_W;
      cv.height = SOURCE_H;
      const gctx = cv.getContext('2d', { alpha: false });
      gctx.drawImage(img, 0, 0, SOURCE_W, SOURCE_H);
    });
  }

  /* ---------------------------------------------------------------------
     9. "WATCH FILM" — quick full-speed burst through every frame, then
        resumes normal loop. A light, dependency-free substitute for a
        modal video player, built from the same frame set. Driven by
        requestAnimationFrame (never setInterval) for the same smooth,
        compositor-friendly pacing as the main hero loop.
  --------------------------------------------------------------------- */
  const watchFilmBtn = document.getElementById('watchFilmBtn');
  let filmPlaying = false;

  function playFilmBurst() {
    stopAnimation(); // prevent the main loop from racing this one on the same canvas
    let i = 0;
    let lastTime = 0;

    function filmTick(timestamp) {
      if (lastTime === 0) lastTime = timestamp;
      const elapsed = timestamp - lastTime;

      if (elapsed >= MS_PER_SOURCE_FRAME) {
        drawFrame(i % FRAME_COUNT);
        i += Math.floor(elapsed / MS_PER_SOURCE_FRAME);
        lastTime = timestamp - (elapsed % MS_PER_SOURCE_FRAME);
      }

      if (i < FRAME_COUNT) {
        requestAnimationFrame(filmTick);
      } else {
        filmPlaying = false;
        state.currentFrame = i % FRAME_COUNT;
        startAnimation(); // hand control back to the normal continuous loop
      }
    }
    requestAnimationFrame(filmTick);
  }

  watchFilmBtn.addEventListener('click', () => {
    if (filmPlaying || !state.ready) return;
    filmPlaying = true;
    document.getElementById('hero').scrollIntoView({ behavior: 'smooth', block: 'start' });
    playFilmBurst();
  });

  /* ---------------------------------------------------------------------
     INIT
  --------------------------------------------------------------------- */
  document.body.style.overflow = 'hidden'; // lock scroll during preload
  document.getElementById('year').textContent = new Date().getFullYear();

  preloadFrames().then(() => {
    state.ready = true;
    drawFrame(0);
    paintGalleryCanvases();
    hideLoader();
    startAnimation();
    updateNavbarSolid();
    updateActiveLink();
    applyHeroTransform();
  });

})();
