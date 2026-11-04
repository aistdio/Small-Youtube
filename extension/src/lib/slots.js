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

  // How many YouTube cards separate two small cards. Above 50% small cards sit side by side.
  const spacing = percent => (percent > 0 && percent <= 50 ? Math.ceil((100 - percent) / percent) : 0);

  const nextPosition = (i, percent, firstBelowScreen, previous = null) => Math.max(
    targetAfter(i, percent),
    firstBelowScreen,
    previous === null ? 0 : previous + spacing(percent),
  );

  const cardsToMove = (segmentCount, perRow) => (perRow > 0 ? segmentCount % perRow : 0);

  const createGeneration = () => {
    let value = 0;
    return {
      current: () => value,
      bump: () => ++value,
      isCurrent: n => n === value,
    };
  };

  (globalThis.SmallYT ??= {}).slots = {
    resolveShare, smallCardsOwed, targetAfter, nextPosition, cardsToMove, createGeneration,
  };
})();
