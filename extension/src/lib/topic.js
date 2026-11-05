// Works out what a video is about, then filters and ranks candidates. No network or page access.
(() => {
  const VIEWS_CUTOFF = 300000;
  const MIN_LENGTH_SECONDS = 60;
  const MAX_QUERY_WORDS = 4;
  const MIN_TERM_LENGTH = 3;
  const MIN_PHRASE_LENGTH = 4;
  const NEAR_COPY_OVERLAP = 0.8;

  const STOP_WORDS = new Set(`the a an and or of to in on for with how what why is are this that my your our you i we it its
    new best top vs from by at as be full official video they their them but so if not no do does did was were will can
    и в на с по за из для как что это а но не от до о об у к ко во со ли же бы то все релиз день часть серия обзор видео`
    .split(/\s+/));

  const words = text => String(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const lower = text => String(text).toLowerCase();
  const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const cleanTitle = (title, channel) => {
    let text = String(title)
      .replace(/#\S+/g, ' ')
      .replace(/[([{【「][^)\]}】」]*[)\]}】」]/g, ' ')
      .replace(/\p{Extended_Pictographic}/gu, ' ')
      .replace(/(?<![\p{L}\p{N}])(part|pt|ep|episode|часть|серия)\.?\s*\d+/giu, ' ');
    if (channel) text = text.split(channel).join(' ');
    return words(text).filter(w => !STOP_WORDS.has(lower(w)) && !/^\d{1,2}$/.test(w));
  };

  const usableTags = (tags, channel) => (tags ?? [])
    .filter(t => typeof t === 'string' && t.trim())
    .filter(t => !channel || !lower(t).includes(lower(channel)));

  const buildQuery = (title, channel, tags) => {
    const titleWords = cleanTitle(title, channel);
    const titleSet = new Set(titleWords.map(lower));
    const usable = usableTags(tags, channel);
    const matching = usable.find(t => words(t).some(w => titleSet.has(lower(w))));
    let picked;
    if (matching) picked = [...words(matching), ...titleWords];
    else if (usable.length >= 2) picked = usable.slice(0, 3).flatMap(words);
    else picked = [...usable.flatMap(words), ...titleWords];
    const seen = new Set();
    const unique = picked.filter(w => !seen.has(lower(w)) && seen.add(lower(w)));
    return unique.slice(0, MAX_QUERY_WORDS).join(' ');
  };

  const topicTerms = (title, channel, tags) => [...cleanTitle(title, channel), ...usableTags(tags, channel).slice(0, 6)];

  const matchesPhrase = (title, phrase) => {
    if (!phrase) return false;
    return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}])`, 'iu').test(title);
  };

  const bestPhrase = (title, tags) => {
    const found = (tags ?? [])
      .filter(t => typeof t === 'string' && t.length >= MIN_PHRASE_LENGTH && matchesPhrase(title, t))
      .sort((a, b) => b.length - a.length);
    return found[0] ?? null;
  };

  const isNearCopy = (a, b) => {
    const setA = new Set(words(lower(a)));
    const setB = new Set(words(lower(b)));
    if (!setA.size || !setB.size) return false;
    const shared = [...setA].filter(w => setB.has(w)).length;
    return shared / new Set([...setA, ...setB]).size >= NEAR_COPY_OVERLAP;
  };

  // Some titles are made only of invisible characters, which would leave a card with nothing to read.
  const INVISIBLE = /[\s\p{C}\p{M}⠀ᅟᅠㅤﾠ]/gu;
  const isBlankTitle = title => !String(title ?? '').replace(INVISIBLE, '');

  const passesCheapFilters = (candidate, { seed, settings, shownIds, hiddenChannels, mutedPhrases }) => {
    const c = candidate;
    if (isBlankTitle(c.title)) return false;
    if (c.id === seed.id || shownIds.has(c.id) || hiddenChannels.has(c.channelId)) return false;
    if (c.isShort || c.lengthSeconds == null || c.lengthSeconds < MIN_LENGTH_SECONDS) return false;
    if (typeof c.views !== 'number' || c.views < settings.viewsMin) return false;
    if (settings.viewsMax !== null && c.views > settings.viewsMax) return false;
    if (settings.viewsMin < VIEWS_CUTOFF && c.views > VIEWS_CUTOFF) return false;
    if (c.channelName === seed.channelName || isNearCopy(c.title, seed.title)) return false;
    if (settings.skipDubbed && c.autoDubbedLabel) return false;
    return !mutedPhrases.some(p => matchesPhrase(c.title, p));
  };

  const isOnTopic = (candidate, terms) => terms.some(t => t.length >= MIN_TERM_LENGTH && matchesPhrase(candidate.title, t));

  const lookupOrder = (candidates, terms) => [
    ...candidates.filter(c => isOnTopic(c, terms)),
    ...candidates.filter(c => !isOnTopic(c, terms)),
  ];

  const inSubscriberRange = (subs, settings) => typeof subs === 'number'
    && subs >= settings.subsMin
    && (settings.subsMax === null || subs <= settings.subsMax);

  const viewsPerSubscriber = c => c.views / Math.max(c.subs, 1);
  const rank = (candidates, terms) => {
    const best = (a, b) => viewsPerSubscriber(b) - viewsPerSubscriber(a);
    return [
      ...candidates.filter(c => isOnTopic(c, terms)).sort(best),
      ...candidates.filter(c => !isOnTopic(c, terms)).sort(best),
    ];
  };

  const chooseOrder = (ranked, rng) => {
    if (!ranked.length) return [];
    const index = Math.floor(rng() * Math.min(3, ranked.length));
    return [ranked[index], ...ranked.filter((_, i) => i !== index)];
  };

  (globalThis.SmallYT ??= {}).topic = {
    cleanTitle, buildQuery, topicTerms, bestPhrase, matchesPhrase, isNearCopy, isBlankTitle, passesCheapFilters,
    isOnTopic, lookupOrder, inSubscriberRange, rank, chooseOrder,
  };
})();
