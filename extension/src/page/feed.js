// Watches YouTube's page, asks for cards as the viewer gets near them, and inserts them.
(() => {
  const { ytPage, slots, cards } = globalThis.SmallYT;
  const S = ytPage.SELECTORS;

  const MARK = 'data-small-yt';
  const HIDDEN = 'small-yt-hidden';
  const NEAR_SCREENS = 1.5;
  const MAX_PENDING = 2;
  const FILL_DELAY_MS = 400;
  const RESIZE_DELAY_MS = 300;
  const CONTAINER_POLL_MS = 500;
  const CONTAINER_POLL_LIMIT = 40;
  const SEED_RETRY_LIMIT = 10;
  const SEED_SEARCH_RADIUS = 6;
  const RENDER_FAILURES_TO_STOP = 3;

  let send = () => {};
  let config = null;
  const generation = slots.createGeneration();
  let percent = 0;
  let requested = 0;
  let placed = 0;
  let pending = 0;
  let slotCounter = 0;
  let seedRetries = 0;
  let renderFailures = 0;
  let fillTimer = null;
  let resizeTimer = null;
  let observer = null;
  let observed = null;
  let startedFor = null;
  let seedUses = new Map();
  let positionOffset = 0;

  const isOn = c => !!c?.settings?.enabled && c.settings.share !== 0;
  const surface = () => {
    if (location.pathname === '/') return 'home';
    if (location.pathname === '/watch') return 'watch';
    return null;
  };
  const containerFor = surf => document.querySelector(surf === 'watch' ? S.watchColumn : S.homeGrid);

  const isSmall = el => el.hasAttribute(MARK);
  const isHidden = el => el.classList.contains(HIDDEN);
  const smallCards = () => [...document.querySelectorAll(`[${MARK}]`)];
  const belowScreen = el => el.getBoundingClientRect().top >= innerHeight;
  const nearLimit = () => innerHeight * (1 + NEAR_SCREENS);

  const youTubeCards = surf => {
    const root = containerFor(surf);
    if (!root) return [];
    if (surf === 'watch') {
      return [...root.querySelectorAll(S.lockup)].filter(el => !isSmall(el) && el.querySelector(S.videoLink));
    }
    return [...root.querySelectorAll(`:scope > ${S.homeItem}`)]
      .filter(el => !isSmall(el) && !el.querySelector(S.ad) && el.querySelector(S.lockup));
  };

  const currentVideoId = () => new URLSearchParams(location.search).get('v');
  const watchSeed = () => {
    const id = currentVideoId();
    const video = document.querySelector(S.player)?.getVideoData?.();
    if (video?.video_id === id && video.title) return { id, title: video.title, channelName: video.author ?? '' };
    if (seedRetries < SEED_RETRY_LIMIT) {
      seedRetries++;
      return null;
    }
    const title = document.querySelector(S.watchTitle)?.textContent?.trim();
    return title ? { id, title, channelName: document.querySelector(S.watchChannel)?.textContent?.trim() ?? '' } : null;
  };

  // A seed near the card's position, so a card tends to sit close to the video that led to it.
  // Above 50% there are more small cards than YouTube cards, so a seed can supply several.
  const homeSeed = (list, position) => {
    const maxUses = percent > 50 ? 3 : 1;
    const seeds = list
      .map((el, index) => ({ index, seed: ytPage.seedFromLockup(el.data?.content?.lockupViewModel) }))
      .filter(({ seed }) => seed && (seedUses.get(seed.id) ?? 0) < maxUses);
    if (!seeds.length) return null;
    const near = seeds.filter(({ index }) => Math.abs(index - position) <= SEED_SEARCH_RADIUS);
    const from = near.length ? near : seeds;
    const { seed } = from[Math.floor(Math.random() * from.length)];
    seedUses.set(seed.id, (seedUses.get(seed.id) ?? 0) + 1);
    return seed;
  };

  const schedule = (delay = FILL_DELAY_MS) => {
    if (fillTimer) return;
    fillTimer = setTimeout(() => {
      fillTimer = null;
      fill();
    }, delay);
  };

  const watchContainer = surf => {
    const root = containerFor(surf);
    if (!root || root === observed) return;
    observer?.disconnect();
    observed = root;
    observer = new MutationObserver(() => schedule());
    observer.observe(root, { childList: true, subtree: true });
  };

  const nearEnough = (list, position) => {
    const anchor = list[Math.min(position, list.length) - 1];
    const last = smallCards().at(-1);
    return slots.mayRequest({
      percent,
      anchorTop: anchor ? anchor.getBoundingClientRect().top : null,
      lastSmallTop: last ? last.getBoundingClientRect().top : null,
      hasShownBelow: list.some(el => !isHidden(el) && belowScreen(el)),
      limit: nearLimit(),
    });
  };

  function fill() {
    if (!isOn(config) || config.paused || renderFailures >= RENDER_FAILURES_TO_STOP) return;
    const surf = surface();
    if (!surf) return;
    watchContainer(surf);
    const list = youTubeCards(surf);
    const owed = slots.smallCardsOwed(list.length, percent);
    while (pending < MAX_PENDING && requested < owed) {
      const position = slots.targetAfter(requested, percent);
      if (!nearEnough(list, position)) return;
      const seed = surf === 'watch' ? watchSeed() : homeSeed(list, position);
      if (!seed) {
        if (surf === 'watch') schedule(1000);
        return; // on home, new YouTube cards bring new seeds and wake this up
      }
      requested++;
      pending++;
      send('needCard', { slotId: ++slotCounter, generation: generation.current(), seed });
    }
  }

  const insertAfterSmallCards = (anchor, el) => {
    let after = anchor;
    while (after.nextElementSibling && isSmall(after.nextElementSibling)) after = after.nextElementSibling;
    after.after(el);
  };

  // Keeps rows complete: a card too many before a full-width section such as Shorts would leave a gap.
  const fixRows = () => {
    const root = containerFor('home');
    const gridRoot = document.querySelector(S.homeGridRoot);
    if (!root || !gridRoot) return;
    const perRow = Number(getComputedStyle(gridRoot).getPropertyValue(ytPage.ITEMS_PER_ROW_VAR));
    let segment = [];
    for (const child of [...root.children]) {
      if (child.matches(S.homeSection)) {
        const extra = slots.cardsToMove(segment.length, perRow);
        const moving = extra ? segment.slice(-extra) : [];
        for (const el of [...moving].reverse()) child.after(el);
        segment = moving;
      } else if (child.matches(S.homeItem) && !isHidden(child)) {
        segment.push(child);
      }
    }
  };

  const place = async (card, asked) => {
    const surf = surface();
    const list = youTubeCards(surf);
    const shown = list.filter(el => !isHidden(el));
    if (!shown.length) return 'no-position';
    const below = shown.findIndex(belowScreen);
    const firstBelow = below < 0 ? shown.length : below;

    let anchor;
    let replaced = null;
    if (percent >= 100) {
      if (below < 0) return 'no-position'; // only replace off screen, so nothing swaps in view
      replaced = shown[firstBelow];
      anchor = replaced;
    } else {
      const { position, offset } = slots.placeAfter(placed, percent, firstBelow, positionOffset);
      positionOffset = offset;
      anchor = shown[Math.max(Math.min(position, shown.length), 1) - 1];
    }

    const referenceWidth = Math.round(anchor.getBoundingClientRect().width);
    const el = surf === 'watch' ? cards.createWatchCard(card.lockup, anchor) : cards.createHomeCard(card.lockup, anchor);
    cards.prepareFade(el);
    if (replaced) replaced.before(el);
    else insertAfterSmallCards(anchor, el);
    el.setAttribute(MARK, String(asked));
    placed++;

    const good = await cards.settle(el, referenceWidth);
    const wanted = slots.cardStillWanted({
      current: generation.isCurrent(asked),
      on: isOn(config),
      paused: !!config?.paused,
      replacing: !!replaced,
      replacedBelow: !!replaced && belowScreen(replaced),
    });
    if (!good || !wanted) {
      el.remove();
      if (generation.isCurrent(asked)) placed--;
      return good ? 'no-position' : 'failed';
    }
    el.setAttribute(MARK, String(asked));
    if (replaced) replaced.classList.add(HIDDEN);
    cards.remember(el, card);
    cards.fadeIn(el);
    if (surf === 'home') fixRows();
    renderFailures = 0;
    return 'placed';
  };

  const unhideAll = () => {
    for (const el of document.querySelectorAll(`.${HIDDEN}`)) el.classList.remove(HIDDEN);
  };

  const removeAll = () => {
    const hadCards = smallCards().length > 0;
    for (const el of smallCards()) el.remove();
    unhideAll();
    if (hadCards && surface() === 'home') fixRows();
  };

  const removeCards = list => {
    for (const el of list) el.remove();
    if (surface() === 'home') fixRows();
    schedule();
  };

  const restart = () => {
    startedFor = location.href;
    const asked = generation.bump();
    document.documentElement.setAttribute('data-small-yt-page', String(asked));
    removeAll();
    requested = 0;
    placed = 0;
    pending = 0;
    seedRetries = 0;
    renderFailures = 0;
    seedUses = new Map();
    positionOffset = 0;
    observer?.disconnect();
    observed = null;
    if (!isOn(config)) return;
    percent = slots.resolveShare(config.settings.share, Math.random);
    const surf = surface();
    if (!surf) return;
    let polls = 0;
    const wait = () => {
      if (!generation.isCurrent(asked)) return;
      if (containerFor(surf)) {
        watchContainer(surf);
        schedule();
      } else if (++polls < CONTAINER_POLL_LIMIT) {
        setTimeout(wait, CONTAINER_POLL_MS);
      }
    };
    wait();
  };

  const onCard = async ({ generation: asked, card }) => {
    if (!generation.isCurrent(asked)) return;
    pending = Math.max(0, pending - 1);
    const onHome = surface() === 'home';
    const giveBackSlot = () => { requested = Math.max(0, requested - 1); };
    if (card && !config?.paused) {
      const result = await place(card, asked);
      if (!generation.isCurrent(asked)) return;
      if (result === 'failed') renderFailures++;
      if (result !== 'placed') giveBackSlot();
    } else if (card || onHome) {
      giveBackSlot(); // try another seed later; each seed is only used a limited number of times
    }
    schedule();
  };

  const applyConfig = next => {
    const wasOn = isOn(config);
    config = next;
    if (!isOn(config)) {
      const asked = generation.bump(); // cards still on their way are now from an old page
      document.documentElement.setAttribute('data-small-yt-page', String(asked));
      removeAll();
      return;
    }
    if (config.paused) unhideAll();
    if (!wasOn) restart();
    else schedule();
  };

  const start = sendMessage => {
    send = sendMessage;
    const style = document.createElement('style');
    style.textContent = `.${HIDDEN} { display: none !important; }`;
    document.documentElement.append(style);
    // YouTube also fires this during the first load, which isn't a new page.
    document.addEventListener(ytPage.NAVIGATE_FINISH_EVENT, () => {
      if (location.href !== startedFor) restart();
    });
    addEventListener('scroll', () => schedule(), { passive: true });
    addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (surface() === 'home' && smallCards().length) fixRows();
      }, RESIZE_DELAY_MS);
    }, { passive: true });
  };

  (globalThis.SmallYT ??= {}).feed = { start, onCard, applyConfig, removeAll, removeCards, smallCards };
})();
