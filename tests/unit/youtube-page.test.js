import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.js';
import '../../extension/src/youtube.js';
import '../../extension/src/youtube-page.js';

const { seedFromLockup } = globalThis.SmallYT.ytPage;
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
