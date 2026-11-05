// Everything saved in the browser. Storage calls throw after the extension is updated or
// reloaded while YouTube stays open, so each call fails quietly instead of breaking the page.
(() => {
  const CHANNEL_CACHE_MS = 7 * 24 * 3600 * 1000;
  const SHOWN_LIMIT = 2000;
  const WATCHED_LIMIT = 200;
  const NO_BLOCKS = { channels: [], phrases: [], seedChannels: [], words: [] };
  const NO_WATCHED = { count: 0, videos: [] };

  const createStore = (chromeApi, now) => {
    const { normalize } = globalThis.SmallYT.settings;

    const get = async key => {
      try {
        return (await chromeApi.storage.local.get(key))[key];
      } catch {
        return undefined;
      }
    };
    const set = async (key, value) => {
      try {
        await chromeApi.storage.local.set({ [key]: value });
      } catch {
        // The extension context is gone, so there's nothing left to save to.
      }
    };

    const isAlive = () => {
      try {
        return !!chromeApi.runtime?.id;
      } catch {
        return false;
      }
    };

    // Saved settings can't be read once the context is gone, and defaults must not switch anything on.
    const getSettings = async () => {
      const settings = normalize(await get('settings'));
      return isAlive() ? settings : { ...settings, enabled: false };
    };
    const setSettings = async patch => set('settings', normalize({ ...(await get('settings')), ...patch }));

    // These saves read a whole list and write it back, so at the same time they'd lose each other's changes.
    let saves = Promise.resolve();
    const inTurn = save => {
      saves = saves.then(save, save);
      return saves;
    };

    const getSubs = async channelId => {
      const entry = (await get('channels'))?.[channelId];
      return entry && now() - entry.at <= CHANNEL_CACHE_MS ? entry.subs : undefined;
    };
    const setSubs = (channelId, subs) => inTurn(async () => {
      const kept = {};
      for (const [id, entry] of Object.entries((await get('channels')) ?? {})) {
        if (now() - entry.at <= CHANNEL_CACHE_MS) kept[id] = entry;
      }
      kept[channelId] = { subs, at: now() };
      await set('channels', kept);
    });

    const getShown = async () => new Set((await get('shown')) ?? []);
    const addShown = id => inTurn(async () => set('shown', [...((await get('shown')) ?? []), id].slice(-SHOWN_LIMIT)));

    const getBlocks = async () => ({ ...NO_BLOCKS, ...(await get('blocks')) });
    const updateBlocks = async change => {
      const blocks = await getBlocks();
      change(blocks);
      await set('blocks', blocks);
    };
    const hideChannel = (id, name) => updateBlocks(b => {
      if (!b.channels.some(c => c.id === id)) b.channels = [...b.channels, { id, name }];
    });
    const muteTopic = phrase => updateBlocks(b => {
      if (!b.phrases.includes(phrase)) b.phrases = [...b.phrases, phrase];
    });
    const muteSeedChannel = name => updateBlocks(b => {
      if (!b.seedChannels.includes(name)) b.seedChannels = [...b.seedChannels, name];
    });
    const banWord = word => updateBlocks(b => {
      const clean = word.trim();
      if (clean && !b.words.some(w => w.toLowerCase() === clean.toLowerCase())) b.words = [...b.words, clean];
    });
    const unblock = item => updateBlocks(b => {
      if (item.channelId) b.channels = b.channels.filter(c => c.id !== item.channelId);
      if (item.phrase) b.phrases = b.phrases.filter(p => p !== item.phrase);
      if (item.seedChannel) b.seedChannels = b.seedChannels.filter(s => s !== item.seedChannel);
      if (item.word) b.words = b.words.filter(w => w !== item.word);
    });

    const getWatched = async () => ({ ...NO_WATCHED, ...(await get('watched')) });
    const addWatched = async video => {
      const { count, videos } = await getWatched();
      const others = videos.filter(v => v.id !== video.id);
      await set('watched', {
        count: others.length === videos.length ? count + 1 : count,
        videos: [video, ...others].slice(0, WATCHED_LIMIT),
      });
    };
    const clearWatched = () => set('watched', NO_WATCHED);

    const onChange = fn => {
      try {
        chromeApi.storage.onChanged.addListener((changes, area) => {
          if (area === 'local') fn(changes);
        });
      } catch {
        // The extension context is gone.
      }
    };

    return {
      isAlive, getSettings, setSettings, getSubs, setSubs, getShown, addShown, getBlocks, hideChannel, muteTopic,
      muteSeedChannel, banWord, unblock, getWatched, addWatched, clearWatched, onChange, getState: get, setState: set,
    };
  };

  (globalThis.SmallYT ??= {}).store = { createStore };
})();
