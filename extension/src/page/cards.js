// Creates cards that YouTube itself renders, so they match its look in any theme, language or layout.
(() => {
  const S = globalThis.SmallYT.ytPage.SELECTORS;

  const WIDTH_TOLERANCE_PX = 1;
  const SETTLE_TIMEOUT_MS = 3000;
  const SETTLE_POLL_MS = 150;
  const FADE = 'opacity 400ms ease';

  const verifyRendered = ({ hasTitle, width, referenceWidth }) => !!hasTitle
    && width > 0
    && Math.abs(width - referenceWidth) <= WIDTH_TOLERANCE_PX;

  // Setting `data` alone renders a tall card here: it also needs the neighbour's layout properties.
  const createWatchCard = (lockup, neighbour) => {
    const el = document.createElement(S.lockup);
    el.className = neighbour.className;
    for (const key of Object.keys(neighbour)) {
      if (key === 'data' || key.startsWith('__')) continue;
      try {
        el[key] = neighbour[key];
      } catch {
        // Read-only property.
      }
    }
    el.data = lockup;
    return el;
  };

  const createHomeCard = (lockup, neighbour) => {
    const el = document.createElement(S.homeItem);
    for (const attr of neighbour.attributes) {
      if (attr.name !== 'class' && attr.name !== 'style') el.setAttribute(attr.name, attr.value);
    }
    el.className = neighbour.className;
    el.data = { ...neighbour.data, content: { lockupViewModel: lockup } };
    return el;
  };

  const measure = el => ({
    hasTitle: !!el.querySelector(S.title)?.textContent?.trim(),
    width: Math.round(el.getBoundingClientRect().width),
  });

  // Waits for YouTube to finish rendering, then checks the card. Never sets a size.
  const settle = async (el, referenceWidth) => {
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, SETTLE_POLL_MS));
      if (!el.isConnected) return false;
      if (verifyRendered({ ...measure(el), referenceWidth })) return true;
    }
    return false;
  };

  const prepareFade = el => {
    el.style.opacity = '0';
    el.style.transition = FADE;
  };
  const fadeIn = el => { el.style.opacity = '1'; };

  // What each small card is, for the ⋮ menu actions.
  const known = new WeakMap();
  const remember = (el, card) => known.set(el, card);
  const recall = el => known.get(el);

  // The menu is YouTube's own, built from data we extended. Our entries borrow an existing entry's
  // action, so their clicks must be caught before YouTube handles them.
  const closeMenu = () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    document.body.click();
  };

  const installMenu = ({ cardMark, getLabels, onLessTopic, onHideChannel }) => {
    let lastCard = null;
    document.addEventListener('pointerdown', e => {
      const card = e.target.closest?.(`[${cardMark}]`);
      if (card) lastCard = card;
    }, true);
    document.addEventListener('click', e => {
      const item = e.target.closest?.(S.menuItem);
      if (!item) return;
      const [less, hide] = getLabels();
      const text = (item.innerText ?? '').trim();
      if (text !== less && text !== hide) return;
      e.stopPropagation();
      e.preventDefault();
      closeMenu();
      const card = lastCard && recall(lastCard);
      if (!card) return;
      if (text === less) onLessTopic(lastCard, card);
      else onHideChannel(card);
    }, true);
  };

  (globalThis.SmallYT ??= {}).cards = {
    verifyRendered, createWatchCard, createHomeCard, measure, settle, prepareFade, fadeIn, remember, recall, installMenu,
  };
})();
