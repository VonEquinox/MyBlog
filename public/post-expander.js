// Inline full-screen expander (NO overlay container).
// Target interaction:
// - Click a card -> it expands to full-screen.
// - Other cards DO NOT reflow down; they fly out of the viewport along the
//   direction from the clicked card to each card (connecting-line direction).
// - After expansion, other cards are hidden.
// - A left-side "返回上一级" button collapses back to the original list position,
//   with other cards flying back in.

const root = document.documentElement;
const grid = document.querySelector('[data-post-grid]');

if (!grid) {
  // Nothing to do.
  console.warn('[post-expander] Missing [data-post-grid]');
} else {
  const cards = Array.from(grid.querySelectorAll('[data-post-card]'));
  const originalOrder = cards.slice();

  // Motion tuning
  // Temporarily slow down motion for tuning/debugging.
  // 200% = 2x duration (slower).
  const TIME_SCALE = 2;
  const DURATION_ACTIVE = 720 * TIME_SCALE;
  const DURATION_SIBLINGS = 650 * TIME_SCALE;
  const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
  // When to swap from the frozen "ghost" title to the real title (0~1).
  const TITLE_SWAP_AT = 0.82;
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let activeCard = null;
  let isAnimating = false;
  let previousScrollY = 0;

  let lastSession = null;

  const px = (value) => {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  };

  const setReadingMode = (enabled) => {
    if (enabled) root.dataset.reading = 'true';
    else delete root.dataset.reading;
  };

  const centerOf = (rect) => ({
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  });

  const normalize = (dx, dy) => {
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  };

  const exitDistance = () => Math.hypot(window.innerWidth, window.innerHeight) * 1.1;

  const getChromeTargets = () => {
    const headerEl = document.querySelector('[data-site-header]');
    const heroEl = document.querySelector('[data-home-hero]');
    const hintEl = document.querySelector('[data-home-hint]');

    const targets = [];
    if (headerEl instanceof HTMLElement) targets.push({ key: 'header', el: headerEl });
    if (heroEl instanceof HTMLElement) targets.push({ key: 'hero', el: heroEl });
    if (hintEl instanceof HTMLElement) targets.push({ key: 'hint', el: hintEl });
    return targets;
  };

  const captureRectsByKey = (targets) => {
    const rectsByKey = new Map();
    for (const { key, el } of targets) rectsByKey.set(key, el.getBoundingClientRect());
    return rectsByKey;
  };

  const computeExitDirsByKey = (activeRect, rectsByKey) => {
    const activeCenter = centerOf(activeRect);
    const dirs = new Map();
    for (const [key, rect] of rectsByKey.entries()) {
      const c = centerOf(rect);
      dirs.set(key, normalize(c.x - activeCenter.x, c.y - activeCenter.y));
    }
    return dirs;
  };

  const applyChromeMotionStyles = (targets) => {
    for (const { el } of targets) {
      el.style.willChange = 'transform, opacity';
      el.style.pointerEvents = 'none';

      // Ensure z-index works (static elements need a position).
      const pos = getComputedStyle(el).position;
      if (pos === 'static') el.style.position = 'relative';

      // Keep them above the expanding card so the "挤开" is visible.
      el.style.zIndex = '240';
    }
  };

  const clearChromeMotionStyles = (targets) => {
    for (const { el } of targets) {
      el.style.willChange = '';
      el.style.pointerEvents = '';
      el.style.position = '';
      el.style.zIndex = '';
      el.style.opacity = '';
      el.style.transform = '';
    }
  };

  const vectorFromDir = (dir) => {
    const d = exitDistance();
    return { x: dir.x * d, y: dir.y * d };
  };

  const getTitleElements = (card) => {
    const summaryEl = card.querySelector('.post-card__summary');
    if (!(summaryEl instanceof HTMLElement)) return null;
    const titleEl = summaryEl.querySelector('h2');
    if (!(titleEl instanceof HTMLElement)) return null;
    return { summaryEl, titleEl };
  };

  const measureTitleHeightOffscreen = (titleEl, widthPx) => {
    if (widthPx <= 0) return 0;
    const cs = getComputedStyle(titleEl);
    const probe = document.createElement('div');
    probe.style.position = 'fixed';
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    probe.style.left = '0';
    probe.style.top = '0';
    probe.style.zIndex = '-1';
    probe.style.margin = '0';
    probe.style.padding = '0';
    probe.style.border = '0';
    probe.style.boxSizing = 'border-box';
    probe.style.width = `${widthPx}px`;

    probe.style.fontFamily = cs.fontFamily;
    probe.style.fontSize = cs.fontSize;
    probe.style.fontWeight = cs.fontWeight;
    probe.style.fontStyle = cs.fontStyle;
    probe.style.fontStretch = cs.fontStretch;
    probe.style.fontVariationSettings = cs.fontVariationSettings;
    probe.style.fontFeatureSettings = cs.fontFeatureSettings;
    probe.style.lineHeight = cs.lineHeight;
    probe.style.letterSpacing = cs.letterSpacing;
    probe.style.textTransform = cs.textTransform;
    probe.style.textDecoration = cs.textDecoration;
    probe.style.textRendering = cs.textRendering;

    probe.style.whiteSpace = cs.whiteSpace;
    probe.style.wordBreak = cs.wordBreak;
    probe.style.overflowWrap = cs.overflowWrap;
    probe.style.hyphens = cs.hyphens;
    probe.style.textWrap = cs.textWrap;

    probe.textContent = titleEl.textContent ?? '';
    document.body.appendChild(probe);
    const height = probe.getBoundingClientRect().height;
    probe.remove();
    return height;
  };

  const measureFinalTitleWidthPx = ({ summaryEl, expanded, targetCardWidthPx }) => {
    const cs = getComputedStyle(summaryEl);
    const padLeft = px(cs.paddingLeft);
    const padRight = px(cs.paddingRight);

    if (expanded) {
      // Expanded summary width is min(100%, 72rem) while the card is full-viewport.
      const rootFontPx = px(getComputedStyle(document.documentElement).fontSize) || 16;
      const maxSummaryWidthPx = 72 * rootFontPx;
      const summaryWidthPx = Math.min(window.innerWidth, maxSummaryWidthPx);
      return Math.max(0, summaryWidthPx - padLeft - padRight);
    }

    // Collapsed summary width equals the final card width in the grid.
    return Math.max(0, targetCardWidthPx - padLeft - padRight);
  };

  const setupTitleMorph = ({ card, expanded, targetCardWidthPx }) => {
    // Always apply the state change even if we skip morph.
    const applyState = () => setExpandedState(expanded ? card : null);

    if (prefersReducedMotion) {
      applyState();
      return null;
    }

    const els = getTitleElements(card);
    if (!els) {
      applyState();
      return null;
    }

    const { summaryEl, titleEl } = els;

    const fromSummaryRect = summaryEl.getBoundingClientRect();
    const fromTitleRect = titleEl.getBoundingClientRect();
    const fromX = fromTitleRect.left - fromSummaryRect.left;
    const fromY = fromTitleRect.top - fromSummaryRect.top;
    const fromHeight = fromTitleRect.height;
    const fromFontPx = px(getComputedStyle(titleEl).fontSize) || 1;

    // Create a frozen "ghost" title that keeps its line breaks while scaling.
    const ghostEl = document.createElement('div');
    ghostEl.dataset.titleGhost = 'true';
    ghostEl.setAttribute('aria-hidden', 'true');
    ghostEl.textContent = titleEl.textContent ?? '';
    ghostEl.style.position = 'absolute';
    ghostEl.style.left = `${fromX}px`;
    ghostEl.style.top = `${fromY}px`;
    ghostEl.style.width = `${fromTitleRect.width}px`;
    ghostEl.style.height = `${fromTitleRect.height}px`;
    ghostEl.style.transformOrigin = 'top left';
    ghostEl.style.pointerEvents = 'none';
    ghostEl.style.zIndex = '3';
    ghostEl.style.willChange = 'transform, opacity';

    const fromTitleStyle = getComputedStyle(titleEl);
    ghostEl.style.fontFamily = fromTitleStyle.fontFamily;
    ghostEl.style.fontSize = fromTitleStyle.fontSize;
    ghostEl.style.fontWeight = fromTitleStyle.fontWeight;
    ghostEl.style.fontStyle = fromTitleStyle.fontStyle;
    ghostEl.style.fontStretch = fromTitleStyle.fontStretch;
    ghostEl.style.fontVariationSettings = fromTitleStyle.fontVariationSettings;
    ghostEl.style.fontFeatureSettings = fromTitleStyle.fontFeatureSettings;
    ghostEl.style.lineHeight = fromTitleStyle.lineHeight;
    ghostEl.style.letterSpacing = fromTitleStyle.letterSpacing;
    ghostEl.style.textTransform = fromTitleStyle.textTransform;
    ghostEl.style.textDecoration = fromTitleStyle.textDecoration;
    ghostEl.style.textRendering = fromTitleStyle.textRendering;
    ghostEl.style.color = fromTitleStyle.color;
    ghostEl.style.whiteSpace = fromTitleStyle.whiteSpace;
    ghostEl.style.wordBreak = fromTitleStyle.wordBreak;
    ghostEl.style.overflowWrap = fromTitleStyle.overflowWrap;
    ghostEl.style.hyphens = fromTitleStyle.hyphens;
    ghostEl.style.textWrap = fromTitleStyle.textWrap;

    const prevSummaryPosition = summaryEl.style.position;
    if (getComputedStyle(summaryEl).position === 'static') summaryEl.style.position = 'relative';
    summaryEl.appendChild(ghostEl);

    const prevTitleOpacity = titleEl.style.opacity;
    const prevTitleHeight = titleEl.style.height;
    const prevTitleOverflow = titleEl.style.overflow;
    const prevTitleWillChange = titleEl.style.willChange;
    const prevTitleTransition = titleEl.style.transition;

    titleEl.style.opacity = '0';
    titleEl.style.willChange = 'height, opacity';

    // Apply target state without font transitions so measurements are stable.
    titleEl.style.transition = 'none';
    applyState();

    const toSummaryRect = summaryEl.getBoundingClientRect();
    const toTitleRect = titleEl.getBoundingClientRect();
    const toX = toTitleRect.left - toSummaryRect.left;
    const toY = toTitleRect.top - toSummaryRect.top;
    const deltaX = toX - fromX;
    const deltaY = toY - fromY;

    const toFontPx = px(getComputedStyle(titleEl).fontSize) || fromFontPx;
    const toTitleWidthPx = measureFinalTitleWidthPx({
      summaryEl,
      expanded,
      targetCardWidthPx,
    });
    const toHeight = measureTitleHeightOffscreen(titleEl, toTitleWidthPx) || toTitleRect.height;

    titleEl.style.transition = prevTitleTransition;

    // Lock height back to fromHeight, then animate to the measured final height.
    titleEl.style.height = `${fromHeight}px`;
    titleEl.style.overflow = 'hidden';

    const scaleTo = toFontPx / Math.max(fromFontPx, 1);

    const ghostTransformAnim = ghostEl.animate(
      [
        { transform: 'translate(0px, 0px) scale(1)' },
        { transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleTo})` },
      ],
      {
        duration: DURATION_ACTIVE,
        easing: EASING,
        fill: 'forwards',
      }
    );

    const ghostOpacityAnim = ghostEl.animate(
      [
        { opacity: 1, offset: 0 },
        { opacity: 1, offset: TITLE_SWAP_AT },
        { opacity: 0, offset: 1 },
      ],
      {
        duration: DURATION_ACTIVE,
        easing: 'linear',
        fill: 'forwards',
      }
    );

    const titleOpacityAnim = titleEl.animate(
      [
        { opacity: 0, offset: 0 },
        { opacity: 0, offset: TITLE_SWAP_AT },
        { opacity: 1, offset: 1 },
      ],
      {
        duration: DURATION_ACTIVE,
        easing: 'linear',
        fill: 'forwards',
      }
    );

    const titleHeightAnim = titleEl.animate(
      [{ height: `${fromHeight}px` }, { height: `${toHeight}px` }],
      {
        duration: DURATION_ACTIVE,
        easing: EASING,
        fill: 'forwards',
      }
    );

    const promise = Promise.all([
      ghostTransformAnim.finished,
      ghostOpacityAnim.finished,
      titleOpacityAnim.finished,
      titleHeightAnim.finished,
    ]).then(() => {
      for (const anim of [ghostTransformAnim, ghostOpacityAnim, titleOpacityAnim, titleHeightAnim]) {
        try {
          anim.commitStyles();
        } catch {
          // commitStyles not supported in some browsers; ignore.
        }
        anim.cancel();
      }
    });

    const cleanup = () => {
      ghostEl.remove();
      titleEl.style.opacity = prevTitleOpacity;
      titleEl.style.height = prevTitleHeight;
      titleEl.style.overflow = prevTitleOverflow;
      titleEl.style.willChange = prevTitleWillChange;
      titleEl.style.transition = prevTitleTransition;
      summaryEl.style.position = prevSummaryPosition;
    };

    return { promise, cleanup };
  };

  const captureLayout = () => {
    const rectsByCard = new Map();
    for (const card of cards) rectsByCard.set(card, card.getBoundingClientRect());
    const gridRect = grid.getBoundingClientRect();
    return { rectsByCard, gridRect, scrollY: window.scrollY };
  };

  const computeExitVectors = (activeRect, rectsByCard) => {
    const activeCenter = centerOf(activeRect);
    const distance = exitDistance();
    const exit = new Map();

    for (const [card, rect] of rectsByCard.entries()) {
      if (card === activeCard) continue;
      const c = centerOf(rect);
      const dir = normalize(c.x - activeCenter.x, c.y - activeCenter.y);
      exit.set(card, { x: dir.x * distance, y: dir.y * distance });
    }
    return exit;
  };

  const freezeCardsAsFixed = (rectsByCard) => {
    const gridRect = grid.getBoundingClientRect();
    grid.style.height = `${gridRect.height}px`;

    for (const [card, rect] of rectsByCard.entries()) {
      card.hidden = false;
      card.style.position = 'fixed';
      card.style.left = `${rect.left}px`;
      card.style.top = `${rect.top}px`;
      card.style.width = `${rect.width}px`;
      card.style.height = `${rect.height}px`;
      // Prevent expanded styles (min-height: 100svh) from forcing the fixed card
      // to instantly become full-screen during animation.
      card.style.minHeight = '0';
      card.style.margin = '0';
      card.style.transformOrigin = 'top left';
      card.style.willChange = 'left, top, width, height, transform, opacity, border-radius';
      card.style.zIndex = card === activeCard ? '200' : '150';
    }
  };

  const clearFixedStyles = () => {
    grid.style.height = '';
    for (const card of cards) {
      card.style.position = '';
      card.style.left = '';
      card.style.top = '';
      card.style.width = '';
      card.style.height = '';
      card.style.minHeight = '';
      card.style.margin = '';
      card.style.transformOrigin = '';
      card.style.willChange = '';
      card.style.zIndex = '';
      card.style.opacity = '';
      card.style.transform = '';
      card.style.borderRadius = '';
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

  const restoreOriginalOrder = () => {
    for (const el of originalOrder) grid.appendChild(el);
  };

  const open = async (card) => {
    if (isAnimating) return;
    if (!(card instanceof HTMLElement)) return;
    if (activeCard === card) return;

    isAnimating = true;
    previousScrollY = window.scrollY;

    activeCard = card;
    const layout = captureLayout();
    const activeRect = layout.rectsByCard.get(activeCard);
    if (!activeRect) {
      isAnimating = false;
      return;
    }

    const exitVectors = computeExitVectors(activeRect, layout.rectsByCard);
    const chromeTargets = getChromeTargets();
    const chromeRectsByKey = captureRectsByKey(chromeTargets);
    const chromeDirsByKey = computeExitDirsByKey(activeRect, chromeRectsByKey);
    lastSession = {
      layout,
      activeId: activeCard.dataset.postId ?? null,
      activeRect,
      exitVectors,
      chromeDirsByKey,
    };

    freezeCardsAsFixed(layout.rectsByCard);
    // Now that positions are frozen, we can reveal the panel content immediately
    // (it will be clipped by the fixed height) and animate the card bounds.
    // This avoids the "content scales up then snaps" feel from transform scaling.
    activeCard.dataset.animating = 'true';
    activeCard.style.borderRadius = '26px';
    setExpandedState(activeCard);

    // Chrome (header/hero/hint) should be pushed away too (NO overlay).
    applyChromeMotionStyles(chromeTargets);
    const chromeAnimations = [];
    for (const { key, el } of chromeTargets) {
      const dir = chromeDirsByKey.get(key);
      if (!dir) continue;
      const vec = vectorFromDir(dir);
      const anim = el.animate(
        [
          { transform: 'translate(0px, 0px)', opacity: 1 },
          { transform: `translate(${vec.x}px, ${vec.y}px)`, opacity: 0 },
        ],
        {
          duration: DURATION_ACTIVE,
          easing: EASING,
          fill: 'forwards',
        }
      );
      chromeAnimations.push(
        anim.finished.then(() => {
          anim.commitStyles();
          anim.cancel();
        })
      );
    }

    const siblingAnimations = [];
    for (const [otherCard, vec] of exitVectors.entries()) {
      siblingAnimations.push(
        otherCard.animate(
          [
            { transform: 'translate(0px, 0px)', opacity: 1 },
            { transform: `translate(${vec.x}px, ${vec.y}px)`, opacity: 0 },
          ],
          {
            duration: DURATION_SIBLINGS,
            easing: EASING,
            fill: 'forwards',
          }
        ).finished
      );
    }

    const activeAnimation = activeCard.animate(
      [
        {
          left: `${activeRect.left}px`,
          top: `${activeRect.top}px`,
          width: `${activeRect.width}px`,
          height: `${activeRect.height}px`,
          borderRadius: '26px',
        },
        {
          left: '0px',
          top: '0px',
          width: `${window.innerWidth}px`,
          height: `${window.innerHeight}px`,
          borderRadius: '0px',
        },
      ],
      {
        duration: DURATION_ACTIVE,
        easing: EASING,
        fill: 'forwards',
      }
    );

    await Promise.all([activeAnimation.finished, ...siblingAnimations, ...chromeAnimations]);
    activeAnimation.commitStyles();
    activeAnimation.cancel();
    delete activeCard.dataset.animating;

    // Switch to reading mode (no overlay): hide chrome + hide other cards.
    setReadingMode(true);
    clearChromeMotionStyles(chromeTargets);
    grid.prepend(activeCard);
    for (const otherCard of cards) {
      if (otherCard !== activeCard) otherCard.hidden = true;
    }

    // Reset styles back to normal flow and let CSS handle full-screen layout.
    clearFixedStyles();
    window.scrollTo({ top: 0 });

    const back = card.querySelector('[data-post-close]');
    if (back instanceof HTMLElement) back.focus();

    isAnimating = false;
  };

  const close = async () => {
    if (isAnimating) return;
    if (!activeCard) return;
    if (!lastSession) return;

    isAnimating = true;
    const closingCard = activeCard;
    const closingId = closingCard.dataset.postId ?? null;
    const targetRect = lastSession.activeRect;

    // Freeze the active card at its CURRENT visual position first (so clicking back
    // doesn't jump to the top of the article before shrinking).
    const startRect = closingCard.getBoundingClientRect();
    closingCard.style.position = 'fixed';
    closingCard.style.left = `${startRect.left}px`;
    closingCard.style.top = `${startRect.top}px`;
    closingCard.style.width = `${startRect.width}px`;
    closingCard.style.height = `${startRect.height}px`;
    closingCard.style.minHeight = '0';
    closingCard.style.margin = '0';
    closingCard.style.transformOrigin = 'top left';
    closingCard.style.willChange = 'left, top, width, height, opacity, border-radius';
    closingCard.style.zIndex = '200';
    // Immediately collapse internal layout (hide panel / restore card-like header),
    // but keep the frozen outer rect so it feels continuous.
    closingCard.dataset.animating = 'true';
    closingCard.style.borderRadius = '0px';

    const chromeTargets = getChromeTargets();
    const chromeDirsByKey = lastSession.chromeDirsByKey instanceof Map ? lastSession.chromeDirsByKey : new Map();

    // Pre-place chrome offscreen BEFORE we turn reading mode off,
    // so it won't flash at its final position.
    applyChromeMotionStyles(chromeTargets);
    for (const { key, el } of chromeTargets) {
      const dir = chromeDirsByKey.get(key);
      if (!dir) continue;
      const vec = vectorFromDir(dir);
      el.style.transform = `translate(${vec.x}px, ${vec.y}px)`;
      el.style.opacity = '0';
    }

    // Restore page chrome behind, restore scroll position of the list.
    for (const card of cards) card.hidden = false;
    setReadingMode(false);
    restoreOriginalOrder();
    window.scrollTo({ top: lastSession.layout.scrollY });
    // Show the normal card summary so the title reflows naturally while shrinking.
    setExpandedState(null);

    // Freeze sibling cards at their ORIGINAL positions (captured at open).
    grid.style.height = `${lastSession.layout.gridRect.height}px`;
    for (const [card, rect] of lastSession.layout.rectsByCard.entries()) {
      if (card === closingCard) continue;
      card.style.position = 'fixed';
      card.style.left = `${rect.left}px`;
      card.style.top = `${rect.top}px`;
      card.style.width = `${rect.width}px`;
      card.style.height = `${rect.height}px`;
      card.style.margin = '0';
      card.style.transformOrigin = 'top left';
      card.style.willChange = 'transform, opacity';
      card.style.zIndex = '150';
    }

    // Other cards start offscreen and fly back.
    const siblingAnimations = [];
    for (const [otherCard, vec] of lastSession.exitVectors.entries()) {
      otherCard.style.opacity = '0';
      otherCard.style.transform = `translate(${vec.x}px, ${vec.y}px)`;
      siblingAnimations.push(
        otherCard.animate(
          [
            { transform: `translate(${vec.x}px, ${vec.y}px)`, opacity: 0 },
            { transform: 'translate(0px, 0px)', opacity: 1 },
          ],
          {
            duration: DURATION_SIBLINGS,
            easing: EASING,
            fill: 'forwards',
          }
        ).finished
      );
    }

    const activeAnimation = closingCard.animate(
      [
        {
          left: `${startRect.left}px`,
          top: `${startRect.top}px`,
          width: `${startRect.width}px`,
          height: `${startRect.height}px`,
          borderRadius: '0px',
          opacity: 1,
        },
        {
          left: `${targetRect.left}px`,
          top: `${targetRect.top}px`,
          width: `${targetRect.width}px`,
          height: `${targetRect.height}px`,
          borderRadius: '26px',
          opacity: 1,
        },
      ],
      {
        duration: DURATION_ACTIVE,
        easing: EASING,
        fill: 'forwards',
      }
    );

    const chromeInAnimations = [];
    for (const { key, el } of chromeTargets) {
      const dir = chromeDirsByKey.get(key);
      if (!dir) continue;
      const vec = vectorFromDir(dir);
      const anim = el.animate(
        [
          { transform: `translate(${vec.x}px, ${vec.y}px)`, opacity: 0 },
          { transform: 'translate(0px, 0px)', opacity: 1 },
        ],
        {
          duration: DURATION_ACTIVE,
          easing: EASING,
          fill: 'forwards',
        }
      );
      chromeInAnimations.push(
        anim.finished.then(() => {
          anim.commitStyles();
          anim.cancel();
        })
      );
    }

    await Promise.all([activeAnimation.finished, ...siblingAnimations, ...chromeInAnimations]);
    activeAnimation.commitStyles();
    activeAnimation.cancel();
    delete closingCard.dataset.animating;
    clearChromeMotionStyles(chromeTargets);

    // Restore normal flow list.
    activeCard = null;
    clearFixedStyles();
    window.scrollTo({ top: previousScrollY });

    const openBtn = closingCard.querySelector('[data-post-open]');
    if (openBtn instanceof HTMLElement) openBtn.focus();

    isAnimating = false;
    if (closingId === lastSession.activeId) lastSession = null;
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
