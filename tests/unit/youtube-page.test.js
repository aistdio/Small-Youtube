import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.js';
import '../../extension/src/youtube.js';
import '../../extension/src/youtube-page.js';

const { seedFromLockup, orderEntries, lockupOf } = globalThis.SmallYT.ytPage;
const { parseNext } = globalThis.SmallYT.yt;
const realLockup = () => parseNext(load('next.en.json'), 'en').find(c => c.lengthSeconds).lockup;

test('a normal video card can be a seed', () => {
  const lockup = realLockup();
  const seed = seedFromLockup(lockup);
  assert.equal(seed.id, lockup.contentId);
  assert.ok(seed.title.length > 0);
  assert.ok(seed.channelName.length > 0);
});

test('mixes, Shorts, live streams and unknown shapes are not seeds', () => {
  assert.equal(seedFromLockup({ ...realLockup(), contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST' }), null);
  assert.equal(seedFromLockup({ ...realLockup(), contentImage: {} }), null); // no length shown, as on a live stream
  const short = realLockup();
  short.rendererContext = { commandContext: { onTap: { url: '/shorts/abc' } } };
  assert.equal(seedFromLockup(short), null);
  assert.equal(seedFromLockup(undefined), null);
  assert.equal(seedFromLockup({ unexpected: true }), null);
});

test('a card\'s video data can be read in the home grid and in the watch column', () => {
  const lockup = realLockup();
  assert.equal(lockupOf({ data: { content: { lockupViewModel: lockup } } }), lockup);
  assert.equal(lockupOf({ data: Symbol('hidden'), rawProps: { data: () => lockup } }), lockup);
  assert.equal(lockupOf({}), undefined);
});

const homeEntry = name => ({ richItemRenderer: { name } });
const homeEl = entry => ({ data: entry.richItemRenderer });
const addedCard = name => {
  const entry = homeEntry(name);
  return { el: homeEl(entry), entry };
};
const noAdded = { entryOf: () => undefined, isAddedEntry: () => false };
const addedOnes = (...cards) => ({
  entryOf: el => cards.find(c => c.el === el)?.entry,
  isAddedEntry: entry => cards.some(c => c.entry === entry),
});

test('an added card gets an entry at its position', () => {
  const [a, b] = [homeEntry('a'), homeEntry('b')];
  const small = addedCard('small');
  const result = orderEntries([a, b], [homeEl(a), small.el, homeEl(b)], addedOnes(small));
  assert.deepEqual(result, [a, small.entry, b]);
});

test('entries YouTube has not drawn yet stay after the drawn ones, in order', () => {
  const [a, b, c] = [homeEntry('a'), homeEntry('b'), homeEntry('c')];
  const small = addedCard('small');
  assert.deepEqual(orderEntries([a, b, c], [homeEl(a), small.el], addedOnes(small)), [a, small.entry, b, c]);
});

test('a removed added card loses its entry', () => {
  const [a, b] = [homeEntry('a'), homeEntry('b')];
  const small = addedCard('small');
  assert.deepEqual(orderEntries([a, small.entry, b], [homeEl(a), homeEl(b)], addedOnes(small)), [a, b]);
});

test('a moved card moves its entry', () => {
  const [a, b, c] = [homeEntry('a'), homeEntry('b'), homeEntry('c')];
  assert.deepEqual(orderEntries([a, b, c], [homeEl(a), homeEl(c), homeEl(b)], noAdded), [a, c, b]);
});

test('an element with no entry is ignored', () => {
  const [a, b] = [homeEntry('a'), homeEntry('b')];
  const stray = { data: { stale: true } };
  assert.deepEqual(orderEntries([a, b], [homeEl(a), stray, homeEl(b)], noAdded), [a, b]);
});
