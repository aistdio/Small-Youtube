// Everything specific to YouTube's pages and data lives in this file: selectors, endpoints,
// parsers and the card builder. When YouTube changes something, start here.
(() => {
  const ORIGINAL_TRACK_SUFFIX = '.4';
  const AUTODUB_TRACK_SUFFIX = '.10';
  const AUTODUB_ICON = 'PERSON_RADAR_FILLED';
  const VIDEO_FILTER = 'EgIQAQ==';
  const CHANNEL_VIDEOS_TAB = 'EgZ2aWRlb3PyBgQKAjoA';

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
  };

  const api = endpoint => `/youtubei/v1/${endpoint}?prettyPrint=false`;
  const ENDPOINTS = {
    search: api('search'),
    next: api('next'),
    browse: api('browse'),
    player: api('player'),
    results: query => `/results?search_query=${encodeURIComponent(query)}&sp=${encodeURIComponent(VIDEO_FILTER)}`,
    watch: videoId => `/watch?v=${encodeURIComponent(videoId)}`,
    accountPlayback: '/account_playback',
  };
  const NAVIGATE_FINISH_EVENT = 'yt-navigate-finish';
  const LANGUAGE_PANEL_REQUEST = /get_panel/;
  const ITEMS_PER_ROW_VAR = '--ytd-rich-grid-items-per-row';

  const collect = (value, key, found = []) => {
    if (!value || typeof value !== 'object') return found;
    if (value[key]) found.push(value[key]);
    for (const k in value) collect(value[k], key, found);
    return found;
  };

  const normalizeText = text => String(text)
    .replace(/[    ]/g, ' ')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .trim();

  const EXTRA_SUFFIXES = { k: 1e3, m: 1e6, b: 1e9, 'tsd.': 1e3, tsd: 1e3, 'mio.': 1e6, 'mrd.': 1e9 };
  const suffixTables = new Map();
  const suffixTable = hl => {
    if (suffixTables.has(hl)) return suffixTables.get(hl);
    const table = { ...EXTRA_SUFFIXES };
    for (const compactDisplay of ['short', 'long']) {
      let format;
      try {
        format = new Intl.NumberFormat(hl, { notation: 'compact', compactDisplay, maximumFractionDigits: 0 });
      } catch {
        continue;
      }
      for (let power = 1e3; power <= 1e12; power *= 10) {
        const parts = format.formatToParts(power);
        const compact = parts.find(p => p.type === 'compact')?.value;
        const integer = Number(parts.filter(p => p.type === 'integer').map(p => p.value).join(''));
        if (compact && integer) table[normalizeText(compact).toLowerCase()] = power / integer;
      }
    }
    const entries = Object.entries(table).sort((a, b) => b[0].length - a[0].length);
    suffixTables.set(hl, entries);
    return entries;
  };

  const parseCount = (text, hl) => {
    if (text == null) return null;
    const clean = normalizeText(text);
    if (/^no views/i.test(clean)) return 0;
    const match = clean.match(/\d[\d\s.,'’]*/);
    if (!match) return null;
    const number = match[0].trim();
    const rest = clean.slice(match.index + match[0].length).trim().toLowerCase();
    for (const [suffix, multiplier] of suffixTable(hl)) {
      if (!rest.startsWith(suffix)) continue;
      const next = rest[suffix.length] ?? '';
      if (/[\p{Script=Latin}\p{Script=Cyrillic}]/u.test(next)) continue;
      const decimal = number.replace(/[\s'’]/g, '').replace(',', '.');
      const value = Number(decimal);
      return Number.isFinite(value) ? Math.round(value * multiplier) : null;
    }
    const digits = number.replace(/\D/g, '');
    return digits ? Number(digits) : null;
  };

  const formatCount = (n, hl) => new Intl.NumberFormat(hl, { notation: 'compact', maximumFractionDigits: 1 }).format(n);

  const parseLength = text => {
    if (!text || !/^\d+(:\d{2})+$/.test(String(text).trim())) return null;
    return String(text).trim().split(':').reduce((total, part) => total * 60 + Number(part), 0);
  };

  const hasAutoDubIcon = value => JSON.stringify(value ?? {}).includes(AUTODUB_ICON);
  const isShortUrl = url => /\/shorts\//.test(url ?? '');

  const fromRenderer = hl => v => {
    const owner = v.ownerText?.runs?.[0];
    const viewText = v.viewCountText?.simpleText ?? v.viewCountText?.runs?.map(r => r.text).join('');
    return {
      id: v.videoId,
      title: v.title?.runs?.[0]?.text ?? '',
      channelName: owner?.text ?? '',
      channelId: owner?.navigationEndpoint?.browseEndpoint?.browseId ?? null,
      views: parseCount(viewText, hl),
      lengthSeconds: parseLength(v.lengthText?.simpleText),
      isShort: isShortUrl(v.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url),
      autoDubbedLabel: hasAutoDubIcon(v.badges),
      source: 'search',
      renderer: v,
    };
  };

  const channelIdIn = value => (JSON.stringify(value ?? {}).match(/"browseId":"(UC[\w-]{22})"/) || [])[1] ?? null;
  const lengthIn = contentImage => {
    const m = JSON.stringify(contentImage ?? {}).match(/"text":"(\d+(?::\d{2})+)"/);
    return m ? parseLength(m[1]) : null;
  };

  const fromLockup = hl => l => {
    const meta = l.metadata?.lockupMetadataViewModel;
    const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows ?? [];
    const parts = rows[1]?.metadataParts ?? [];
    return {
      id: l.contentId,
      title: meta?.title?.content ?? '',
      channelName: rows[0]?.metadataParts?.[0]?.text?.content ?? '',
      channelId: channelIdIn(l),
      views: parseCount(parts[0]?.text?.content, hl),
      lengthSeconds: lengthIn(l.contentImage),
      isShort: isShortUrl(JSON.stringify(l.rendererContext?.commandContext ?? {})),
      autoDubbedLabel: hasAutoDubIcon(rows),
      source: 'related',
      lockup: l,
    };
  };

  const parseSearch = (json, hl) => collect(json, 'videoRenderer')
    .map(fromRenderer(hl))
    .filter(c => c.id && c.channelId);

  const parseNext = (json, hl) => collect(json, 'lockupViewModel')
    .filter(l => l.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO')
    .map(fromLockup(hl))
    .filter(c => c.id);

  const embeddedJson = (html, name) => {
    const m = String(html).match(new RegExp(`var ${name}\\s*=\\s*(\\{[\\s\\S]*?\\});\\s*(?:var |</script>)`));
    if (!m) return null;
    try {
      return JSON.parse(m[1]);
    } catch {
      return null;
    }
  };

  const parseSearchPage = (html, hl) => parseSearch(embeddedJson(html, 'ytInitialData'), hl);
  const parseWatchRelated = (html, hl) => parseNext(embeddedJson(html, 'ytInitialData'), hl);

  const parseSubscribers = json => {
    const m = JSON.stringify(json ?? {}).match(/"([\d.,]+[KMB]?) subscribers?"/);
    return m ? parseCount(m[1], 'en') : null;
  };

  const parseTags = json => json?.videoDetails?.keywords ?? [];

  const parseWatchPage = html => {
    const player = embeddedJson(html, 'ytInitialPlayerResponse');
    if (!player?.videoDetails) return null;
    const tracks = new Map();
    for (const format of player.streamingData?.adaptiveFormats ?? []) {
      const track = format.audioTrack;
      if (track && !tracks.has(track.id)) tracks.set(track.id, { id: track.id, isDefault: !!track.audioIsDefault });
    }
    const captions = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    return {
      title: player.videoDetails.title ?? '',
      tracks: [...tracks.values()],
      autoCaptions: captions.filter(c => c.kind === 'asr').map(c => c.languageCode),
    };
  };

  const continuationToken = json => collect(json, 'continuationCommand').pop()?.token ?? null;

  (globalThis.SmallYT ??= {}).yt = {
    ORIGINAL_TRACK_SUFFIX, AUTODUB_TRACK_SUFFIX, VIDEO_FILTER, CHANNEL_VIDEOS_TAB, SELECTORS, ENDPOINTS,
    NAVIGATE_FINISH_EVENT, LANGUAGE_PANEL_REQUEST, ITEMS_PER_ROW_VAR,
    parseCount, formatCount, parseSearch, parseNext, parseSearchPage, parseWatchRelated,
    parseSubscribers, parseTags, parseWatchPage, continuationToken, collect,
  };
})();
