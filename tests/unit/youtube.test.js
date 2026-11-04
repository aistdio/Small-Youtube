import test from 'node:test';
import assert from 'node:assert/strict';
import { load, read } from './helpers.js';
import '../../extension/src/youtube.js';

const { parseCount, formatCount, parseSearch, parseNext, parseSearchPage, parseWatchRelated, parseSubscribers, parseTags, parseWatchPage, continuationToken, ORIGINAL_TRACK_SUFFIX, AUTODUB_TRACK_SUFFIX } = globalThis.SmallYT?.yt ?? {};

test('parseCount reads compact and exact counts', () => {
  assert.equal(parseCount('710K', 'en'), 710000);
  assert.equal(parseCount('1.2M views', 'en'), 1200000);
  assert.equal(parseCount('710 тыс.', 'ru'), 710000);
  assert.equal(parseCount('1,2 млн', 'ru'), 1200000);
  assert.equal(parseCount('5 802 просмотра', 'ru'), 5802);
  assert.equal(parseCount('No views', 'en'), 0);
  assert.equal(parseCount('nonsense', 'en'), null);
  assert.equal(parseCount('1,234 views', 'en'), 1234);
  assert.equal(parseCount('710 тыс.', 'ru'), 710000); // non-breaking space form below
  assert.equal(parseCount('5,8 тыс.', 'ru'), 5800);
  assert.equal(parseCount('١٢٣', 'ar'), 123);
});

test('formatCount matches YouTube style', () => {
  assert.equal(formatCount(5802, 'ru').replace(/\s/g, ' '), '5,8 тыс.');
  assert.equal(formatCount(710000, 'en'), '710K');
});

test('parsers read real responses', () => {
  const s = parseSearch(load('search.en.json'), 'en');
  assert.ok(s.length >= 5);
  assert.ok(s.every(c => c.id.length === 11 && c.channelId.startsWith('UC') && c.source === 'search' && c.renderer));
  const withLength = s.filter(c => c.lengthSeconds > 0);
  assert.ok(withLength.length >= 1);
  const n = parseNext(load('next.ru.json'), 'ru');
  assert.ok(n.length >= 5 && n.every(c => c.lockup && c.source === 'related'));
  assert.ok(n.some(c => typeof c.views === 'number'));
  assert.ok(n.every(c => c.channelName));
  assert.ok(parseSearchPage(read('results.ru.html'), 'ru').length >= 5);
  assert.ok(parseWatchRelated(read('watch-related.ru.html'), 'ru').length >= 5);
  assert.ok(parseSubscribers(load('browse.en.json')) > 0);
  assert.ok(parseTags(load('player.en.json')).length > 0);
  assert.equal(typeof continuationToken(load('search.en.json')), 'string');
});

test('auto-dubbed label is found by its language-neutral icon', () => {
  const json = load('next.en.json');
  const first = parseNext(json, 'en')[0];
  assert.equal(first.autoDubbedLabel, false);
  const rows = first.lockup.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows;
  rows.push({ badges: [{ badgeViewModel: { badgeText: 'Автодубляж', iconName: 'PERSON_RADAR_FILLED' } }] });
  const again = parseNext({ wrapped: [{ lockupViewModel: first.lockup }] }, 'en')[0];
  assert.equal(again.autoDubbedLabel, true);
});

test('parseWatchPage reads tracks and captions', () => {
  const dub = parseWatchPage(read('watch.dub-default.html'));
  assert.deepEqual(dub.tracks.find(t => t.isDefault).id, 'en-US.10');
  assert.ok(dub.tracks.some(t => t.id === 'pl.4'));
  assert.ok(dub.title.length > 0);
  assert.equal(parseWatchPage(read('watch.original-default.html')).tracks.find(t => t.isDefault).id, 'pl.4');
  assert.deepEqual(parseWatchPage(read('watch.finnish.html')).autoCaptions, ['fi']);
  assert.deepEqual(parseWatchPage(read('watch.no-language.html')).autoCaptions, []);
  assert.equal(ORIGINAL_TRACK_SUFFIX, '.4');
  assert.equal(AUTODUB_TRACK_SUFFIX, '.10');
});

test('unexpected shapes give empty results, not errors', () => {
  assert.deepEqual(parseSearch({ unexpected: true }, 'en'), []);
  assert.deepEqual(parseNext({ unexpected: true }, 'en'), []);
  assert.deepEqual(parseSearch(null, 'en'), []);
  assert.equal(parseSubscribers({}), null);
  assert.deepEqual(parseTags({}), []);
  assert.equal(parseWatchPage('<html>consent</html>'), null);
  assert.deepEqual(parseSearchPage('<html>consent</html>', 'en'), []);
  assert.equal(continuationToken({}), null);
});
