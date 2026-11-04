// The content-script side of the bridge: requests, storage and the pipeline live here.
(() => {
  const { settings: settingsLib, store: storeLib, queue: queueLib, api: apiLib, pipeline: pipelineLib } = globalThis.SmallYT;
  const NS = 'small-yt';
  const STATUS_CHECK_MS = 5000;

  const send = (type, data = {}) => window.postMessage({ ns: NS, from: 'content', type, ...data }, location.origin);

  const store = storeLib.createStore(chrome, Date.now);
  const queue = queueLib.createQueue({
    store,
    now: Date.now,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    isVisible: () => document.visibilityState === 'visible',
  });
  const context = { clientVersion: null, hl: 'en', gl: 'US', loggedIn: false };
  const api = apiLib.createApi({ queue, fetchFn: (...args) => fetch(...args), context });
  const pipeline = pipelineLib.createPipeline({ api, store, rng: Math.random, context });

  const message = key => {
    try {
      return chrome.i18n.getMessage(key);
    } catch {
      return key; // the extension was updated or reloaded while this page stayed open
    }
  };
  const labels = () => [message('menuLessTopic'), message('menuHideChannel')];

  let contextKnown = false;

  const sendConfig = async (extra = {}) => {
    const settings = await store.getSettings();
    send('config', { settings, paused: queue.isHalted(), labels: labels(), ...extra });
  };

  // Reads the account's languages once. A failed attempt doesn't count, and retries at most daily.
  const askForLanguagesIfNeeded = async () => {
    if (!context.loggedIn) return false;
    const state = await store.getState('languageRead');
    if (!settingsLib.shouldReadLanguages(state, Date.now())) return false;
    await store.setState('languageRead', { done: false, lastTry: Date.now() });
    return true;
  };

  const ensureLanguages = async () => {
    const settings = await store.getSettings();
    if (settings.languages === null) {
      await store.setSettings({ languages: settingsLib.initialLanguages(navigator.language) });
    }
  };

  const handlers = {
    context: async data => {
      Object.assign(context, { clientVersion: data.clientVersion, hl: data.hl, gl: data.gl, loggedIn: data.loggedIn });
      let readLanguages = false;
      if (!contextKnown) {
        contextKnown = true;
        await ensureLanguages();
        readLanguages = await askForLanguagesIfNeeded();
      }
      await sendConfig({ readLanguages });
    },
    devReload: async () => {
      if (!chrome.runtime.getManifest().update_url) await chrome.runtime.sendMessage({ type: 'devReload' });
    },
    languages: async ({ codes, hl }) => {
      const settings = await store.getSettings();
      await store.setSettings(settingsLib.applyAccountLanguages(settings, codes, hl));
      await store.setState('languageRead', { done: true, lastTry: Date.now() });
    },
    needCard: async ({ slotId, generation, seed }) => {
      const settings = await store.getSettings();
      const card = settings.enabled && !queue.isHalted() ? await pipeline.findCard(seed, settings, labels()) : null;
      if (!orphaned) send(card ? 'card' : 'noCard', { slotId, generation, card });
    },
    hideChannel: async ({ channelId, channelName }) => {
      await store.hideChannel(channelId, channelName);
    },
    lessTopic: async ({ seed }) => {
      await pipelineLib.handleLessTopic({ seed, tags: await pipeline.tagsFor(seed) }, store);
    },
  };

  // After an update, reload or removal this script keeps running without an extension behind it.
  let orphaned = false;
  let statusTimer = null;
  const stopIfOrphaned = () => {
    if (orphaned) return true;
    if (store.isAlive()) return false;
    orphaned = true;
    clearInterval(statusTimer);
    send('config', { settings: { ...settingsLib.DEFAULTS, enabled: false }, paused: true, labels: [] });
    return true;
  };

  window.addEventListener('message', e => {
    if (e.source !== window || e.data?.ns !== NS || e.data.from !== 'page') return;
    if (stopIfOrphaned()) return;
    handlers[e.data.type]?.(e.data).catch(() => {});
  });

  store.onChange(changes => {
    if (changes.settings) sendConfig().catch(() => {});
  });
  queue.onPauseChange(() => sendConfig().catch(() => {}));
  statusTimer = setInterval(() => {
    if (!stopIfOrphaned()) queue.isHalted();
  }, STATUS_CHECK_MS);

  send('hello');
})();
