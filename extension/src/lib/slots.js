// Where small cards go, worked out from the slider. Runs in the page world, without touching the page.
(() => {
  const resolveShare = (share, rng) => (share === 'random' ? 1 + Math.floor(rng() * 99) : share);

  const smallCardsOwed = (youTubeCount, percent) => {
    if (percent <= 0) return 0;
    if (percent >= 100) return youTubeCount; // one replacement each
    return Math.floor((youTubeCount * percent) / (100 - percent));
  };

  // How many YouTube cards come before small card number i.
  const targetAfter = (i, percent) => {
    if (percent >= 100) return i;
    return Math.ceil(((i + 1) * (100 - percent)) / percent);
  };

  // Cards can't go above the screen, so the whole pattern shifts down instead of bunching up.
  const placeAfter = (i, percent, firstBelowScreen, offset) => {
    const target = targetAfter(i, percent);
    const nextOffset = Math.max(offset, firstBelowScreen - target);
    return { position: target + nextOffset, offset: nextOffset };
  };

  // Above 50% the position barely moves, so the last small card shows how far the fill has got.
  const mayRequest = ({ percent, anchorTop, lastSmallTop, hasShownBelow, limit }) => {
    if (percent >= 100 && !hasShownBelow) return false;
    if (percent > 50) return lastSmallTop == null || lastSmallTop <= limit;
    return anchorTop == null || anchorTop <= limit;
  };

  // Things can change during the seconds a card takes to render.
  const cardStillWanted = ({ current, on, paused, replacing, replacedBelow }) => (
    current && on && (!replacing || (replacedBelow && !paused))
  );

  const cardsToMove = (segmentCount, perRow) => (perRow > 0 ? segmentCount % perRow : 0);

  // How many cards one seed may supply. Some seeds find nothing, so this allows about twice what the share needs.
  const seedUseLimit = percent => {
    const perYouTubeCard = percent >= 100 ? 1 : percent / (100 - percent);
    return Math.ceil(perYouTubeCard * 2) + 1;
  };

  // A seed used once already has its results, so its next card costs far fewer requests. That matters more
  // than sitting close to it, because while the viewer scrolls, the seeds near the next position keep changing.
  const seedChoices = (seeds, position, radius, usesOf) => {
    const usedOnce = seeds.filter(({ seed }) => usesOf(seed) === 1);
    if (usedOnce.length) return usedOnce;
    const near = seeds.filter(({ index }) => Math.abs(index - position) <= radius);
    const from = near.length ? near : seeds;
    const least = Math.min(...from.map(({ seed }) => usesOf(seed)));
    return from.filter(({ seed }) => usesOf(seed) === least);
  };

  const createGeneration = () => {
    let value = 0;
    return {
      current: () => value,
      bump: () => ++value,
      isCurrent: n => n === value,
    };
  };

  (globalThis.SmallYT ??= {}).slots = {
    resolveShare, smallCardsOwed, targetAfter, placeAfter, mayRequest, cardStillWanted, cardsToMove, createGeneration,
    seedUseLimit, seedChoices,
  };
})();
