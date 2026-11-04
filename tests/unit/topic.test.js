import test from 'node:test';
import assert from 'node:assert/strict';
import '../../extension/src/lib/settings.js';
import '../../extension/src/lib/topic.js';

const { DEFAULTS } = globalThis.SmallYT?.settings ?? {};
const { cleanTitle, buildQuery, topicTerms, bestPhrase, matchesPhrase, isNearCopy, passesCheapFilters, lookupOrder, inSubscriberRange, rank, chooseOrder } = globalThis.SmallYT?.topic ?? {};

test('titles and queries', () => {
  assert.deepEqual(cleanTitle('Rina ⚡🧹 - Bass Shake [Zenless Zone Zero MMD] #mmd part 3', 'PulsePixel'), ['Rina', 'Bass', 'Shake']);
  assert.equal(buildQuery('Modern Writing To Invoke A Sense Of Dread', 'BunTheOne', []), 'Modern Writing Invoke Sense');
  assert.ok(buildQuery('Epic Seven — Релиз в Steam 2026! День шестой', 'Nibiru', ['Epic Seven', 'Epic7']).startsWith('Epic Seven'));
  const clickbait = buildQuery('HOLY CRAP!!! They Released Real INGAME FOOTAGE', 'Stix', ['stix', 'mmorpg']);
  assert.ok(!clickbait.toLowerCase().includes('stix'));
  assert.ok(clickbait.includes('mmorpg'));
  assert.ok(buildQuery('Epic Seven — Релиз в Steam 2026! День шестой', 'Nibiru', ['Epic Seven', 'Epic7']).split(' ').length <= 4);
});

test('topic terms combine the title and tags', () => {
  const terms = topicTerms('Paladia против Моро', 'Osvald', ['Epic Seven', 'osvald']);
  assert.ok(terms.includes('Paladia'));
  assert.ok(terms.includes('Epic Seven'));
  assert.ok(!terms.map(t => t.toLowerCase()).includes('osvald'));
});

test('muted phrases match whole', () => {
  assert.equal(bestPhrase('Epic Seven — Steam launch', ['Epic Seven', 'E7']), 'Epic Seven');
  assert.equal(bestPhrase('i humbly submit a toast', []), null);
  assert.ok(matchesPhrase('New epic seven patch', 'Epic Seven'));
  assert.ok(!matchesPhrase('Epic Sevenfold live', 'Epic Seven'));
  assert.ok(matchesPhrase('Обзор: Эпик Севен!', 'эпик севен'));
});

test('near copies are detected', () => {
  assert.ok(isNearCopy('INTERRUPTOR Slowed', 'interruptor (slowed)'));
  assert.ok(!isNearCopy('Epic Seven guide', 'Epic Seven launch'));
});

test('cheap filters', () => {
  const ok = { id: 'a', title: 'Epic Seven guide', channelName: 'X', channelId: 'UCx', views: 500, lengthSeconds: 300, isShort: false };
  const ctx = { seed: { id: 's', title: 'Epic Seven launch', channelName: 'Y' }, settings: DEFAULTS, shownIds: new Set(), hiddenChannels: new Set(), mutedPhrases: [] };
  assert.ok(passesCheapFilters(ok, ctx));
  assert.ok(!passesCheapFilters({ ...ok, lengthSeconds: 59 }, ctx));
  assert.ok(!passesCheapFilters({ ...ok, lengthSeconds: null }, ctx)); // live streams and premieres have no length
  assert.ok(!passesCheapFilters({ ...ok, isShort: true }, ctx));
  assert.ok(!passesCheapFilters({ ...ok, views: 300001 }, ctx));
  assert.ok(!passesCheapFilters({ ...ok, views: null }, ctx));
  assert.ok(passesCheapFilters({ ...ok, views: 400000 }, { ...ctx, settings: { ...DEFAULTS, viewsMin: 300000 } }));
  assert.ok(!passesCheapFilters({ ...ok, views: 5 }, { ...ctx, settings: { ...DEFAULTS, viewsMin: 10 } }));
  assert.ok(!passesCheapFilters({ ...ok, views: 500 }, { ...ctx, settings: { ...DEFAULTS, viewsMax: 100 } }));
  assert.ok(!passesCheapFilters({ ...ok, id: 's' }, ctx));
  assert.ok(!passesCheapFilters({ ...ok, channelName: 'Y' }, ctx));
  assert.ok(!passesCheapFilters({ ...ok, title: 'Epic Seven launch' }, ctx));
  assert.ok(!passesCheapFilters({ ...ok, autoDubbedLabel: true }, ctx));
  assert.ok(passesCheapFilters({ ...ok, autoDubbedLabel: true }, { ...ctx, settings: { ...DEFAULTS, skipDubbed: false } }));
  assert.ok(!passesCheapFilters(ok, { ...ctx, hiddenChannels: new Set(['UCx']) }));
  assert.ok(!passesCheapFilters(ok, { ...ctx, mutedPhrases: ['Epic Seven'] }));
  assert.ok(!passesCheapFilters(ok, { ...ctx, shownIds: new Set(['a']) }));
});

test('ranking uses the design example', () => {
  const v = (id, views, subs, title = 'Epic Seven') => ({ id, views, subs, title });
  const r = rank([v('d', 13, 110), v('c', 180, 59), v('off', 90000, 100, 'Other game'), v('a', 5802, 687), v('b', 662, 118)], ['Epic', 'Seven']);
  assert.deepEqual(r.map(x => x.id), ['a', 'b', 'c', 'd', 'off']);
  assert.ok(rank([v('z', 10, 0)], ['Epic']).length === 1); // 0 subscribers count as 1
  assert.deepEqual(rank([v('zero', 10, 0), v('one', 5, 1)], ['Epic']).map(x => x.id), ['zero', 'one']);
  assert.deepEqual(chooseOrder(r, () => 0.99).map(x => x.id), ['c', 'a', 'b', 'd', 'off']);
  assert.deepEqual(chooseOrder(r, () => 0).map(x => x.id), ['a', 'b', 'c', 'd', 'off']);
  assert.deepEqual(chooseOrder(r.slice(0, 2), () => 0.99).map(x => x.id), ['b', 'a']);
  assert.deepEqual(chooseOrder([], () => 0), []);
  assert.ok(!inSubscriberRange(null, DEFAULTS)); // hidden count
  assert.ok(!inSubscriberRange(undefined, DEFAULTS));
  assert.ok(inSubscriberRange(300, DEFAULTS));
  assert.ok(!inSubscriberRange(9, DEFAULTS));
  assert.ok(!inSubscriberRange(10001, DEFAULTS));
  assert.ok(inSubscriberRange(1e7, { ...DEFAULTS, subsMax: null }));
});

test('lookups go to on-topic candidates first', () => {
  const list = [{ id: 'off', title: 'Other game' }, { id: 'on', title: 'Epic Seven guide' }];
  assert.deepEqual(lookupOrder(list, ['Epic Seven']).map(x => x.id), ['on', 'off']);
});
