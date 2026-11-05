// Watches YouTube's page, asks for cards as the viewer gets near them, and inserts them.
(() => {
  const { ytPage, slots, cards } = globalThis.SmallYT;
  const S = ytPage.SELECTORS;

  const MARK = 'data-small-yt';
  const HIDDEN = 'small-yt-hidden';
  const NEAR_SCREENS = 1.5;
  const MAX_PENDING = 3;
  const FILL_DELAY_MS = 400;
  const RESIZE_DELAY_MS = 300;
  const CONTAINER_POLL_MS = 500;
  const CONTAINER_POLL_LIMIT = 40;
  const SEED_RETRY_LIMIT = 10;
  const WATCH_VIDEO_MISSES = 2; // in a row: its results have run out, so the column's videos become seeds
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
  let slotSeeds = new Map();
  let watchVideoMisses = 0;
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

  const seedFromCards = (list, position) => {
    const uses = seed => seedUses.get(seed.id) ?? 0;
    const maxUses = slots.seedUseLimit(percent);
    const seeds = list
      .map((el, index) => ({ index, seed: ytPage.seedFromLockup(ytPage.lockupOf(el)) }))
      .filter(({ seed }) => seed && uses(seed) < maxUses);
    if (!seeds.length) return null;
    const choices = slots.seedChoices(seeds, position, SEED_SEARCH_RADIUS, uses);
    const { seed } = choices[Math.floor(Math.random() * choices.length)];
    seedUses.set(seed.id, uses(seed) + 1);
    return seed;
  };

  const usingWatchVideo = surf => surf === 'watch' && watchVideoMisses < WATCH_VIDEO_MISSES;

  const removeCardsFromList = list => {
    const parents = new Set(list.map(el => el.parentElement));
    for (const el of list) el.remove();
    for (const parent of parents) ytPage.syncList(parent);
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

  const isRecycledCard = el => cards.isRecycled(cards.recall(el)?.videoId, ytPage.shownVideoId(el));

  // A filter chip swaps the feed without a navigation, and YouTube reuses elements for its new cards.
  // Those are YouTube's now, so they stay and lose our mark, and the fill starts over for the new feed.
  const resetIfFeedChanged = () => {
    const list = smallCards();
    if (!list.some(isRecycledCard)) return;
    const reused = list.filter(isRecycledCard);
    for (const el of reused) {
      el.removeAttribute(MARK);
      el.style.opacity = '';
      el.style.transition = '';
      ytPage.forgetAdded(el);
    }
    removeCardsFromList(list.filter(el => !reused.includes(el)));
    for (const parent of new Set(reused.map(el => el.parentElement))) ytPage.syncList(parent);
    unhideAll();
    const asked = generation.bump(); // cards still on their way were picked for the old feed
    document.documentElement.setAttribute('data-small-yt-page', String(asked));
    requested = 0;
    placed = 0;
    pending = 0;
    renderFailures = 0;
    positionOffset = 0;
    seedUses = new Map();
    slotSeeds = new Map();
    watchVideoMisses = 0;
  };

  function fill() {
    resetIfFeedChanged();
    if (!isOn(config) || config.paused || renderFailures >= RENDER_FAILURES_TO_STOP) return;
    const surf = surface();
    if (!surf) return;
    watchContainer(surf);
    const list = youTubeCards(surf);
    const owed = slots.smallCardsOwed(list.length, percent);
    while (pending < MAX_PENDING && requested < owed) {
      const position = slots.targetAfter(requested, percent) + positionOffset;
      if (!nearEnough(list, position)) return;
      const seed = usingWatchVideo(surf) ? watchSeed() : seedFromCards(list, position);
      if (!seed) {
        if (usingWatchVideo(surf)) schedule(1000);
        return; // otherwise new YouTube cards bring new seeds and wake this up
      }
      requested++;
      pending++;
      slotSeeds.set(++slotCounter, seed);
      send('needCard', { slotId: slotCounter, generation: generation.current(), seed });
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
    ytPage.syncList(root);
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
    if (surf === 'watch') {
      // The column places the cards it loads later by counting its own children, so a card added
      // beside them would push real cards out of order. Inside the card it follows, it isn't counted.
      anchor.append(el);
    } else {
      if (replaced) replaced.before(el);
      else insertAfterSmallCards(anchor, el);
      ytPage.addToList(el);
    }
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
      removeCardsFromList([el]);
      if (generation.isCurrent(asked)) placed--;
      return good ? 'no-position' : 'failed';
    }
    el.setAttribute(MARK, String(asked));
    if (replaced) replaced.classList.add(HIDDEN);
    else if (surf === 'watch') cards.matchGap(el, anchor);
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
    removeCardsFromList(smallCards());
    unhideAll();
    if (hadCards && surface() === 'home') fixRows();
  };

  const removeCards = list => {
    removeCardsFromList(list);
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
    slotSeeds = new Map();
    watchVideoMisses = 0;
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

  const onCard = async ({ generation: asked, slotId, card }) => {
    if (!generation.isCurrent(asked)) return;
    const seed = slotSeeds.get(slotId);
    slotSeeds.delete(slotId);
    pending = Math.max(0, pending - 1);
    const giveBackSlot = () => { requested = Math.max(0, requested - 1); };
    if (card) watchVideoMisses = 0;
    if (card && !config?.paused) {
      const result = await place(card, asked);
      if (!generation.isCurrent(asked)) return;
      if (result === 'failed') renderFailures++;
      if (result !== 'placed') giveBackSlot();
    } else {
      if (!card && seed?.id === currentVideoId()) watchVideoMisses++;
      else if (!card && seed) seedUses.set(seed.id, Infinity); // it has nothing left, so don't spend requests on it again
      giveBackSlot();
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
    // A watch-column card holds the card replacing it, so only its own content is hidden.
    style.textContent = `.${HIDDEN}:not(${S.lockup}) { display: none !important; } ${S.lockup}.${HIDDEN} > :not([${MARK}]) { display: none !important; }`;
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
