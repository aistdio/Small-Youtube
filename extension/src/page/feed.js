// Watches YouTube's page, asks for cards as the viewer gets near them, and inserts them.
(() => {
  const { ytPage, slots, cards } = globalThis.SmallYT;
  const S = ytPage.SELECTORS;

  const MARK = 'data-small-yt';
  const NEAR_SCREENS = 1.5;
  const MAX_PENDING = 2;
  const FILL_DELAY_MS = 400;
  const CONTAINER_POLL_MS = 500;
  const CONTAINER_POLL_LIMIT = 40;
  const SEED_RETRY_LIMIT = 10;

  let send = () => {};
  let config = null;
  const generation = slots.createGeneration();
  let percent = 0;
  let requested = 0;
  let placed = 0;
  let pending = 0;
  let slotCounter = 0;
  let seedRetries = 0;
  let fillTimer = null;
  let observer = null;
  let observed = null;
  let startedFor = null;
  const info = new WeakMap();

  const isOn = c => !!c?.settings?.enabled && c.settings.share !== 0;
  const surface = () => {
    if (location.pathname === '/') return 'home';
    if (location.pathname === '/watch') return 'watch';
    return null;
  };
  const containerFor = surf => document.querySelector(surf === 'watch' ? S.watchColumn : S.homeGrid);

  const isSmall = el => el.hasAttribute(MARK);
  const smallCards = () => [...document.querySelectorAll(`[${MARK}]`)];

  const youTubeCards = surf => {
    const root = containerFor(surf);
    if (!root || surf !== 'watch') return [];
    return [...root.querySelectorAll(S.lockup)].filter(el => !isSmall(el) && el.querySelector(S.videoLink));
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

  const pickSeed = surf => (surf === 'watch' ? watchSeed() : null);

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

  function fill() {
    if (!isOn(config) || config.paused) return;
    const surf = surface();
    if (!surf) return;
    watchContainer(surf);
    const list = youTubeCards(surf);
    const owed = slots.smallCardsOwed(list.length, percent);
    while (pending < MAX_PENDING && requested < owed) {
      const position = slots.targetAfter(requested, percent);
      const anchor = list[Math.min(position, list.length) - 1];
      if (anchor && anchor.getBoundingClientRect().top > innerHeight * (1 + NEAR_SCREENS)) return;
      const seed = pickSeed(surf);
      if (!seed) {
        schedule(1000);
        return;
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

  const place = async (card, asked) => {
    const surf = surface();
    const list = youTubeCards(surf);
    if (!list.length) return;
    const below = list.findIndex(el => el.getBoundingClientRect().top >= innerHeight);
    const firstBelow = below < 0 ? list.length : below;
    const position = Math.min(slots.nextPosition(placed, percent, firstBelow), list.length);
    const anchor = list[Math.max(position, 1) - 1];
    const el = cards.createWatchCard(card.lockup, anchor);
    cards.prepareFade(el);
    insertAfterSmallCards(anchor, el);
    el.setAttribute(MARK, String(asked));
    info.set(el, card);
    placed++;
    const referenceWidth = Math.round(anchor.getBoundingClientRect().width);
    const good = await cards.settle(el, referenceWidth);
    if (!good || !generation.isCurrent(asked)) {
      el.remove();
      return;
    }
    el.setAttribute(MARK, String(asked));
    cards.fadeIn(el);
  };

  const removeAll = () => {
    for (const el of smallCards()) el.remove();
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

  const onCard = ({ generation: asked, card }) => {
    if (!generation.isCurrent(asked)) return;
    pending = Math.max(0, pending - 1);
    if (card) place(card, asked);
    schedule();
  };

  const applyConfig = next => {
    const wasOn = isOn(config);
    config = next;
    if (!isOn(config)) {
      removeAll();
    } else if (!wasOn) {
      restart();
    } else {
      schedule();
    }
  };

  const start = sendMessage => {
    send = sendMessage;
    // YouTube also fires this during the first load, which isn't a new page.
    document.addEventListener(ytPage.NAVIGATE_FINISH_EVENT, () => {
      if (location.href !== startedFor) restart();
    });
    addEventListener('scroll', () => schedule(), { passive: true });
  };

  (globalThis.SmallYT ??= {}).feed = { start, onCard, applyConfig, removeAll };
})();
