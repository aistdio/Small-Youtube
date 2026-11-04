// YouTube's page: selectors, events and reading cards. Runs in the page world.
// src/youtube.js holds the data side. When YouTube changes something, start with these two files.
(() => {
  const SELECTORS = {
    homeGridRoot: 'ytd-rich-grid-renderer',
    homeGrid: 'ytd-rich-grid-renderer #contents',
    homeItem: 'ytd-rich-item-renderer',
    homeSection: 'ytd-rich-section-renderer',
    ad: 'ytd-ad-slot-renderer',
    lockup: 'yt-lockup-view-model',
    watchColumn: 'ytd-watch-next-secondary-results-renderer',
    menuSheet: 'yt-sheet-view-model',
    menuItem: 'yt-list-item-view-model',
    videoLink: 'a[href*="/watch"]',
    title: 'h3',
    dialog: 'tp-yt-paper-dialog',
    settingsLink: 'ytd-settings-options-renderer a[class*="AttributedStringLink"]',
    player: '#movie_player',
    watchTitle: 'ytd-watch-metadata h1',
    watchChannel: 'ytd-watch-metadata ytd-channel-name a',
  };

  const NAVIGATE_FINISH_EVENT = 'yt-navigate-finish';
  const LANGUAGE_PANEL_REQUEST = /get_panel/;
  const ACCOUNT_PLAYBACK_PATH = '/account_playback';
  const ITEMS_PER_ROW_VAR = '--ytd-rich-grid-items-per-row';

  // A home-feed card can seed new picks only if it's a normal video: not a mix, Short or live stream.
  // Live streams and mixes show no length on their thumbnail.
  const seedFromLockup = lockup => {
    if (lockup?.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO' || !lockup.contentId) return null;
    const meta = lockup.metadata?.lockupMetadataViewModel;
    const title = meta?.title?.content;
    const channelName = meta?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content ?? '';
    const hasLength = /"text":"\d+(?::\d{2})+"/.test(JSON.stringify(lockup.contentImage ?? {}));
    const isShort = /\/shorts\//.test(JSON.stringify(lockup.rendererContext?.commandContext ?? {}));
    if (!title || !hasLength || isShort) return null;
    return { id: lockup.contentId, title, channelName };
  };

  (globalThis.SmallYT ??= {}).ytPage = {
    SELECTORS, NAVIGATE_FINISH_EVENT, LANGUAGE_PANEL_REQUEST, ACCOUNT_PLAYBACK_PATH, ITEMS_PER_ROW_VAR, seedFromLockup,
  };
})();
