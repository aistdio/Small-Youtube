// Maps slider positions to values and back. Sliders snap to stops; typed values can sit between them.
(() => {
  const STOPS = [0, 10, 100, 1000, 10000, null];
  const SHARE_STOPS = [0, 25, 50, 75, 100, 'random'];
  const LAST = STOPS.length - 1;

  const valueToPos = value => {
    if (value === null) return 1;
    if (value <= 0) return 0;
    if (value < 10) return (value / 10) / LAST;
    if (value <= 10000) return (1 + Math.log10(value / 10)) / LAST;
    return (4 + (1 - 10000 / value)) / LAST; // above the last number stop, approaching "no limit"
  };

  const nearestStop = (pos, stops) => stops[Math.round(pos * (stops.length - 1))];
  const posToValue = pos => nearestStop(pos, STOPS);

  const MULTIPLIERS = { k: 1e3, к: 1e3, m: 1e6, м: 1e6 };
  const parseTyped = text => {
    const clean = String(text).trim().toLowerCase().replace(/\s/g, '');
    if (clean === '' || clean === '∞') return null;
    const match = clean.match(/^(\d+(?:[.,]\d+)?)([kкmм]?)$/);
    if (!match) return undefined;
    return Math.round(Number(match[1].replace(',', '.')) * (MULTIPLIERS[match[2]] ?? 1));
  };

  const trimmed = number => String(Number(number.toFixed(1)));
  const formatValue = (value, noLimitLabel) => {
    if (value === null) return noLimitLabel;
    if (value >= 1e6) return `${trimmed(value / 1e6)}M`;
    if (value >= 1e3) return `${trimmed(value / 1e3)}k`;
    return String(value);
  };

  const shareToPos = share => (share === 'random' ? 1 : (share / 100) * (4 / 5));
  const posToShare = pos => nearestStop(pos, SHARE_STOPS);
  const parseShare = (text, randomLabel = '') => {
    const clean = String(text).trim().toLowerCase();
    const label = randomLabel.toLowerCase();
    if (clean === 'random' || (label && clean === label) || (clean.length >= 3 && label.startsWith(clean.slice(0, 3)))) return 'random';
    const match = clean.match(/^(\d{1,3})\s*%?$/);
    if (!match) return undefined;
    const value = Number(match[1]);
    return value <= 100 ? value : undefined;
  };

  const REQUEST_STOPS = [1000, 3000, 5000, 10000, null];
  const requestsToPos = value => {
    const last = REQUEST_STOPS.length - 1;
    if (value === null) return 1;
    if (value <= REQUEST_STOPS[0]) return 0;
    if (value >= REQUEST_STOPS[last - 1]) return (last - 1 + (1 - REQUEST_STOPS[last - 1] / value)) / last; // approaching "no limit"
    const i = REQUEST_STOPS.findIndex(stop => value < stop) - 1;
    return (i + (value - REQUEST_STOPS[i]) / (REQUEST_STOPS[i + 1] - REQUEST_STOPS[i])) / last;
  };
  const posToRequests = pos => nearestStop(pos, REQUEST_STOPS);

  // Spreads the small tiles evenly through the preview, like cards through the feed.
  const isSmallTile = (index, percent) => Math.floor(((index + 1) * percent) / 100) > Math.floor((index * percent) / 100);

  (globalThis.SmallYT ??= {}).scale = {
    STOPS, SHARE_STOPS, valueToPos, posToValue, parseTyped, formatValue, shareToPos, posToShare, parseShare, isSmallTile,
    REQUEST_STOPS, requestsToPos, posToRequests,
  };
})();
