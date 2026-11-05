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

  // YouTube auto-captions the speech it hears, so no captions mostly means no speech: cat clips, animations,
  // noise timers. Now and then it's speech YouTube didn't caption, and the page can't tell those apart.
  const hasNoDetectedSpeech = info => !info.tracks.length && !info.autoCaptions.length;

  const decide = (info, settings) => {
    if (!info) return 'skip'; // a consent or sign-in page says nothing about the video
    if (info.aiMade && settings.showAiVideos === false) return 'skip';
    const playsDub = info.tracks.some(t => t.isDefault && t.id.endsWith(AUTODUB_TRACK_SUFFIX));
    if (playsDub) return settings.skipDubbed ? 'skip' : 'keep';
    if (hasNoDetectedSpeech(info)) return settings.showNoSpeechVideos ? 'keep' : 'skip';
    const language = originalLanguage(info);
    return language && (settings.languages ?? ['en']).includes(language) ? 'keep' : 'skip';
  };

  (globalThis.SmallYT ??= {}).language = { originalLanguage, decide };
})();
