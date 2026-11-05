// User settings: defaults, validation and the "My languages" list.
(() => {
  const SHARES = [0, 25, 50, 75, 100, 'random'];

  const DEFAULTS = Object.freeze({
    enabled: true,
    share: 25,
    subsMin: 10,
    subsMax: 10000,
    viewsMin: 0,
    viewsMax: null,
    skipDubbed: true,
    showAiVideos: true,
    showSmallCreatorLabel: true,
    showUnknownLanguage: false,
    useAccountForSearches: false,
    languages: null, // filled on first run, null until then
    languagesEdited: false,
  });

  const baseLanguage = code => String(code).split(/[-_]/)[0].toLowerCase();
  const unique = list => [...new Set(list)];

  const count = (value, fallback, allowNull = false) => {
    if (allowNull && value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.max(0, Math.floor(value));
  };
  const flag = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
  const isShare = value => value === 'random' || (Number.isInteger(value) && value >= 0 && value <= 100);

  const normalize = raw => {
    const r = raw && typeof raw === 'object' ? raw : {};
    const out = {
      enabled: flag(r.enabled, DEFAULTS.enabled),
      share: isShare(r.share) ? r.share : DEFAULTS.share,
      subsMin: count(r.subsMin, DEFAULTS.subsMin),
      subsMax: count(r.subsMax, DEFAULTS.subsMax, true),
      viewsMin: count(r.viewsMin, DEFAULTS.viewsMin),
      viewsMax: count(r.viewsMax, DEFAULTS.viewsMax, true),
      skipDubbed: flag(r.skipDubbed, DEFAULTS.skipDubbed),
      showAiVideos: flag(r.showAiVideos, DEFAULTS.showAiVideos),
      showSmallCreatorLabel: flag(r.showSmallCreatorLabel, DEFAULTS.showSmallCreatorLabel),
      showUnknownLanguage: flag(r.showUnknownLanguage, DEFAULTS.showUnknownLanguage),
      useAccountForSearches: flag(r.useAccountForSearches, DEFAULTS.useAccountForSearches),
      languages: DEFAULTS.languages,
      languagesEdited: flag(r.languagesEdited, DEFAULTS.languagesEdited),
    };
    if (Array.isArray(r.languages)) {
      const list = unique(r.languages.filter(c => typeof c === 'string' && c).map(baseLanguage));
      out.languages = list.length ? list : ['en'];
    }
    if (out.subsMax !== null && out.subsMin > out.subsMax) [out.subsMin, out.subsMax] = [out.subsMax, out.subsMin];
    if (out.viewsMax !== null && out.viewsMin > out.viewsMax) [out.viewsMin, out.viewsMax] = [out.viewsMax, out.viewsMin];
    return out;
  };

  const initialLanguages = browserLanguage => unique(['en', baseLanguage(browserLanguage || 'en')]);
  const mergeAccountLanguages = (codes, hl) => unique([...codes, hl].filter(Boolean).map(baseLanguage));
  const removeLanguage = (list, code) => (list.length > 1 ? list.filter(c => c !== code) : list);

  const DAY_MS = 24 * 3600 * 1000;
  const shouldReadLanguages = (state, now) => !state?.done && now - (state?.lastTry ?? 0) >= DAY_MS;
  const applyAccountLanguages = (settings, codes, hl) => (
    settings.languagesEdited ? settings : { ...settings, languages: mergeAccountLanguages(codes, hl) }
  );

  (globalThis.SmallYT ??= {}).settings = {
    SHARES, DEFAULTS, baseLanguage, normalize, initialLanguages, mergeAccountLanguages, removeLanguage,
    shouldReadLanguages, applyAccountLanguages,
  };
})();
