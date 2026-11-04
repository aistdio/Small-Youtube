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
  };
})();
