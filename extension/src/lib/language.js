// Decides whether a video can be shown, based on its audio tracks and the viewer's languages.
(() => {
  const { ORIGINAL_TRACK_SUFFIX, AUTODUB_TRACK_SUFFIX } = globalThis.SmallYT.yt;
  const { baseLanguage } = globalThis.SmallYT.settings;

  const originalLanguage = info => {
    if (!info) return null;
    const original = info.tracks.find(t => t.id.endsWith(ORIGINAL_TRACK_SUFFIX));
    if (original) return baseLanguage(original.id.slice(0, -ORIGINAL_TRACK_SUFFIX.length));
    return info.autoCaptions.length === 1 ? baseLanguage(info.autoCaptions[0]) : null;
  };

  const decide = (info, settings) => {
    if (info?.aiMade && settings.showAiVideos === false) return 'skip';
    const playsDub = info?.tracks.some(t => t.isDefault && t.id.endsWith(AUTODUB_TRACK_SUFFIX));
    if (playsDub) return settings.skipDubbed ? 'skip' : 'keep';
    const language = originalLanguage(info);
    if (!language) return settings.showUnknownLanguage ? 'keep' : 'skip';
    return (settings.languages ?? ['en']).includes(language) ? 'keep' : 'skip';
  };

  (globalThis.SmallYT ??= {}).language = { originalLanguage, decide };
})();
