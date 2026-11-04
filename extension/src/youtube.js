// YouTube's data: endpoints, parsers and the card builder. Runs in the content script.
// src/youtube-page.js holds the page side. When YouTube changes something, start with these two files.
(() => {
  const ORIGINAL_TRACK_SUFFIX = '.4';
  const AUTODUB_TRACK_SUFFIX = '.10';
  const AUTODUB_ICON = 'PERSON_RADAR_FILLED';
  const VIDEO_FILTER = 'EgIQAQ==';
  const CHANNEL_VIDEOS_TAB = 'EgZ2aWRlb3PyBgQKAjoA';

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

  const clone = value => JSON.parse(JSON.stringify(value));
  const metaOf = lockup => lockup?.metadata?.lockupMetadataViewModel;

  // Search results use a different format from cards, so a search result borrows the shape of a
  // related-list card. Tracking and player data from the template must not carry over.
  const DROPPED_FROM_TEMPLATE = new Set([
    'trackingParams', 'clickTrackingParams', 'params', 'playerParams',
    'loggingDirectives', 'loggingContext', 'attachmentRuns',
  ]);
  const TEXT_KEYS = /content|label|text|title/i;

  const pickTemplate = candidates => candidates
    .map(c => c.lockup)
    .find(l => metaOf(l)?.image?.decoratedAvatarViewModel && l.contentImage?.thumbnailViewModel) ?? null;

  const buildLockup = (template, candidate, hl) => {
    const owner = candidate.renderer.ownerText.runs[0];
    const browse = owner.navigationEndpoint.browseEndpoint;
    const meta = metaOf(template);
    const oldRows = meta.metadata.contentMetadataViewModel.metadataRows;
    const everywhere = [
      [template.contentId, candidate.id],
      [channelIdIn(template), browse.browseId],
      [(JSON.stringify(template).match(/"canonicalBaseUrl":"(\/[^"]+)"/) || [])[1], browse.canonicalBaseUrl],
    ].filter(([from, to]) => from && to);
    const inText = [
      [meta.title.content, candidate.title],
      [oldRows[0].metadataParts[0].text.content, candidate.channelName],
    ].filter(([from, to]) => from && to);

    const swap = (text, pairs) => pairs.reduce((s, [from, to]) => s.split(from).join(to), text);
    const rewrite = (value, key = '') => {
      if (Array.isArray(value)) return value.map(v => rewrite(v, key));
      if (value && typeof value === 'object') {
        const out = {};
        for (const k in value) if (!DROPPED_FROM_TEMPLATE.has(k)) out[k] = rewrite(value[k], k);
        return out;
      }
      if (typeof value !== 'string') return value;
      return swap(TEXT_KEYS.test(key) ? swap(value, inText) : value, everywhere);
    };

    const built = rewrite(template);
    built.contentId = candidate.id;
    built.contentImage.thumbnailViewModel.image.sources = candidate.renderer.thumbnail.thumbnails;

    const m = metaOf(built);
    m.title.content = candidate.title;
    const avatar = m.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image;
    const newAvatar = candidate.renderer.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer?.thumbnail?.thumbnails;
    if (avatar && newAvatar) avatar.sources = newAvatar;

    const rows = m.metadata.contentMetadataViewModel.metadataRows.slice(0, 2);
    rows[0].metadataParts = rows[0].metadataParts.slice(0, 1);
    rows[0].metadataParts[0].text.content = candidate.channelName;
    const views = rows[1].metadataParts[0]?.text;
    if (views) views.content = formatCount(candidate.views, hl);
    const age = rows[1].metadataParts[1]?.text;
    if (age) age.content = candidate.renderer.publishedTimeText?.simpleText ?? '';
    m.metadata.contentMetadataViewModel.metadataRows = rows;

    const setLength = value => {
      if (!value || typeof value !== 'object') return;
      const badge = value.thumbnailBadgeViewModel;
      if (badge && /^\d+:\d{2}/.test(badge.text ?? '')) badge.text = candidate.renderer.lengthText.simpleText;
      for (const k in value) setLength(value[k]);
    };
    setLength(built.contentImage);

    const a11y = built.rendererContext?.accessibilityContext;
    if (a11y) a11y.label = [candidate.title, candidate.channelName, candidate.renderer.viewCountText?.simpleText, age?.content].filter(Boolean).join(', ');
    return built;
  };

  const setLockupTitle = (lockup, title) => {
    const out = clone(lockup);
    metaOf(out).title.content = title;
    return out;
  };

  const findList = value => {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value.listItems)) return value.listItems;
    for (const k in value) {
      const found = findList(value[k]);
      if (found) return found;
    }
    return null;
  };

  const MENU_ICONS = ['NOT_INTERESTED', 'REMOVE_CIRCLE'];

  const addMenuEntries = (lockup, labels) => {
    const out = clone(lockup);
    const list = findList(metaOf(out)?.menuButton);
    if (!list?.length) return out;
    const template = list[list.length - 1];
    labels.forEach((label, index) => {
      const entry = clone(template);
      const item = entry.listItemViewModel;
      if (item?.title) item.title.content = label;
      const icon = item?.leadingImage?.sources?.[0]?.clientResource;
      if (icon) icon.imageName = MENU_ICONS[index] ?? icon.imageName;
      // Without the borrowed action, a missed click does nothing rather than opening Share.
      if (item?.rendererContext) delete item.rendererContext.commandContext;
      list.push(entry);
    });
    return out;
  };

  (globalThis.SmallYT ??= {}).yt = {
    ORIGINAL_TRACK_SUFFIX, AUTODUB_TRACK_SUFFIX, VIDEO_FILTER, CHANNEL_VIDEOS_TAB, ENDPOINTS,
    parseCount, formatCount, parseSearch, parseNext, parseSearchPage, parseWatchRelated,
    parseSubscribers, parseTags, parseWatchPage, continuationToken, collect,
    pickTemplate, buildLockup, setLockupTitle, addMenuEntries,
  };
})();
