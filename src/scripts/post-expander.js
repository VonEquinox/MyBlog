// Inline full-screen expander (NO overlay layers).
// - Expands a card to full screen within normal document flow.
// - Reorders the expanded card to the top, so no cards remain above it.
// - Uses FLIP to animate other cards sliding away and sliding back.

const root = document.documentElement;
const grid = document.querySelector('[data-post-grid]');

if (!grid) {
  // Nothing to do.
  console.warn('[post-expander] Missing [data-post-grid]');
} else {
  const cards = Array.from(grid.querySelectorAll('[data-post-card]'));
  const originalOrder = cards.slice();

  let activeCard = null;
  let isAnimating = false;
  let previousScrollY = 0;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const setReadingMode = (enabled) => {
    if (enabled) root.dataset.reading = 'true';
    else delete root.dataset.reading;
  };

  const getRects = (elements) => {
    const rects = new Map();
    for (const el of elements) rects.set(el, el.getBoundingClientRect());
    return rects;
  };

  const animateFlip = (elements, firstRects, options) => {
    const { duration, easing } = options;

    for (const el of elements) {
      const first = firstRects.get(el);
      if (!first) continue;
      const last = el.getBoundingClientRect();

      const dx = first.left - last.left;
      const dy = first.top - last.top;
      const sx = first.width / Math.max(last.width, 1);
      const sy = first.height / Math.max(last.height, 1);

      const useScale = el === activeCard;
      const transformFrom = useScale
        ? `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`
        : `translate(${dx}px, ${dy}px)`;

      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && (!useScale || (Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01))) {
        continue;
      }

      el.animate([{ transform: transformFrom }, { transform: 'translate(0, 0) scale(1, 1)' }], {
        duration,
        easing,
      });
    }
  };

  const setExpandedState = (nextActiveCard) => {
    for (const card of cards) {
      const isActive = card === nextActiveCard;
      card.dataset.expanded = isActive ? 'true' : 'false';

      const openBtn = card.querySelector('[data-post-open]');
      const panel = card.querySelector('[data-post-panel]');
      if (openBtn instanceof HTMLElement) openBtn.setAttribute('aria-expanded', String(isActive));
      if (panel instanceof HTMLElement) panel.setAttribute('aria-hidden', String(!isActive));
    }
  };

  const reorderForActive = (card) => {
    // Put expanded card first so that it can occupy the whole viewport without cards above it.
    grid.prepend(card);
    for (const el of originalOrder) {
      if (el !== card) grid.appendChild(el);
    }
  };

  const restoreOriginalOrder = () => {
    for (const el of originalOrder) grid.appendChild(el);
  };

  const open = async (card) => {
    if (isAnimating) return;
    if (!(card instanceof HTMLElement)) return;
    if (activeCard === card) return;

    isAnimating = true;
    previousScrollY = window.scrollY;

    const firstRects = getRects(originalOrder);
    activeCard = card;
    setReadingMode(true);
    reorderForActive(card);
    setExpandedState(card);

    // Force layout flush before animating.
    void grid.offsetHeight;

    animateFlip(originalOrder, firstRects, {
      duration: 520,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    });

    await wait(560);
    window.scrollTo({ top: 0 });

    const back = card.querySelector('[data-post-close]');
    if (back instanceof HTMLElement) back.focus();

    isAnimating = false;
  };

  const close = async () => {
    if (isAnimating) return;
    if (!activeCard) return;

    isAnimating = true;
    const closingCard = activeCard;

    const firstRects = getRects(originalOrder);
    setExpandedState(null);
    setReadingMode(false);
    restoreOriginalOrder();

    void grid.offsetHeight;

    animateFlip(originalOrder, firstRects, {
      duration: 480,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    });

    await wait(520);
    activeCard = null;
    window.scrollTo({ top: previousScrollY });

    const openBtn = closingCard.querySelector('[data-post-open]');
    if (openBtn instanceof HTMLElement) openBtn.focus();

    isAnimating = false;
  };

  grid.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const closeBtn = target.closest('[data-post-close]');
    if (closeBtn) {
      await close();
      return;
    }

    const openBtn = target.closest('[data-post-open]');
    if (!openBtn) return;

    const card = openBtn.closest('[data-post-card]');
    if (!(card instanceof HTMLElement)) return;

    await open(card);
  });

  window.addEventListener('keydown', async (event) => {
    if (event.key === 'Escape') await close();
  });
}
