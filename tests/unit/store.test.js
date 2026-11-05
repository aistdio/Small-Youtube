import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeChrome, fakeClock } from './helpers.js';
import '../../extension/src/lib/settings.js';
import '../../extension/src/content/store.js';

const { DEFAULTS } = globalThis.SmallYT?.settings ?? {};
const { createStore } = globalThis.SmallYT?.store ?? {};
const fresh = () => {
  const clock = fakeClock();
  return { clock, chrome: fakeChrome(), store: null };
};
const make = () => {
  const f = fresh();
  f.store = createStore(f.chrome, f.clock.now);
  return f;
};
const WEEK = 7 * 24 * 3600 * 1000;

test('settings round trip through normalize', async () => {
  const { store } = make();
  assert.equal((await store.getSettings()).share, 25);
  await store.setSettings({ share: 50 });
  assert.equal((await store.getSettings()).share, 50);
  await store.setSettings({ share: 700 });
  assert.equal((await store.getSettings()).share, 25);
});

test('channel cache expires after 7 days', async () => {
  const { store, clock } = make();
  await store.setSubs('UC1', 500);
  assert.equal(await store.getSubs('UC1'), 500);
  clock.advance(WEEK + 1);
  assert.equal(await store.getSubs('UC1'), undefined);
});

test('channels saved at the same time are all kept', async () => {
  const { store } = make();
  await Promise.all([store.setSubs('UC1', 1), store.setSubs('UC2', 2), store.setSubs('UC3', 3)]);
  assert.deepEqual([await store.getSubs('UC1'), await store.getSubs('UC2'), await store.getSubs('UC3')], [1, 2, 3]);
});

test('videos marked as shown at the same time are all kept', async () => {
  const { store } = make();
  await Promise.all([store.addShown('a'), store.addShown('b'), store.addShown('c')]);
  assert.deepEqual([...await store.getShown()].sort(), ['a', 'b', 'c']);
});

test('a hidden subscriber count is remembered as null', async () => {
  const { store } = make();
  await store.setSubs('UC2', null);
  assert.equal(await store.getSubs('UC2'), null);
});

test('shown list keeps the latest 2000', async () => {
  const { store } = make();
  for (let i = 0; i < 2005; i++) await store.addShown('v' + i);
  const shown = await store.getShown();
  assert.equal(shown.size, 2000);
  assert.ok(shown.has('v2004'));
  assert.ok(!shown.has('v0'));
});

test('blocks can be added and undone', async () => {
  const { store } = make();
  await store.hideChannel('UC3', 'Three');
  await store.muteTopic('Epic Seven');
  await store.muteSeedChannel('yuyu');
  let b = await store.getBlocks();
  assert.deepEqual(b.channels, [{ id: 'UC3', name: 'Three' }]);
  assert.deepEqual(b.phrases, ['Epic Seven']);
  assert.deepEqual(b.seedChannels, ['yuyu']);
  await store.unblock({ phrase: 'Epic Seven' });
  await store.unblock({ channelId: 'UC3' });
  await store.unblock({ seedChannel: 'yuyu' });
  b = await store.getBlocks();
  assert.deepEqual(b, { channels: [], phrases: [], seedChannels: [], words: [] });
});

test('banned words are trimmed, kept once whatever their case, and can be undone', async () => {
  const { store } = make();
  await store.banWord('  Суицид ');
  await store.banWord('суицид');
  await store.banWord('   ');
  await store.banWord('a');
  assert.deepEqual((await store.getBlocks()).words, ['Суицид', 'a']);
  await store.unblock({ word: 'Суицид' });
  assert.deepEqual((await store.getBlocks()).words, ['a']);
});

const watchedVideo = id => ({ id, title: `Title ${id}`, channelName: `Channel ${id}` });

test('watched videos are listed newest first', async () => {
  const { store } = make();
  assert.deepEqual(await store.getWatched(), { count: 0, videos: [] });
  await store.addWatched(watchedVideo('a'));
  await store.addWatched(watchedVideo('b'));
  assert.deepEqual(await store.getWatched(), { count: 2, videos: [watchedVideo('b'), watchedVideo('a')] });
});

test('a video watched twice counts once and moves to the top', async () => {
  const { store } = make();
  await store.addWatched(watchedVideo('a'));
  await store.addWatched(watchedVideo('b'));
  await store.addWatched(watchedVideo('a'));
  const watched = await store.getWatched();
  assert.equal(watched.count, 2);
  assert.deepEqual(watched.videos.map(v => v.id), ['a', 'b']);
});

test('the watched list keeps the latest 200, and the count keeps going', async () => {
  const { store } = make();
  for (let i = 0; i < 205; i++) await store.addWatched(watchedVideo('v' + i));
  const watched = await store.getWatched();
  assert.equal(watched.count, 205);
  assert.equal(watched.videos.length, 200);
  assert.equal(watched.videos[0].id, 'v204');
  assert.ok(!watched.videos.some(v => v.id === 'v0'));
});

test('clearing the watched list resets the count', async () => {
  const { store } = make();
  await store.addWatched(watchedVideo('a'));
  await store.clearWatched();
  assert.deepEqual(await store.getWatched(), { count: 0, videos: [] });
});

test('changes reach listeners', async () => {
  const { store } = make();
  const seen = [];
  store.onChange(changes => seen.push(Object.keys(changes)));
  await store.setState('pausedUntil', 5);
  assert.equal(await store.getState('pausedUntil'), 5);
  assert.ok(seen.length >= 1);
});

test('invalidated extension context stops quietly', async () => {
  const throwing = () => { throw new Error('Extension context invalidated'); };
  const dead = {
    get runtime() { return throwing(); },
    storage: { local: { get: throwing, set: throwing }, onChanged: { addListener: throwing } },
  };
  const store = createStore(dead, Date.now);
  assert.equal(store.isAlive(), false);
  assert.deepEqual(await store.getSettings(), { ...DEFAULTS, enabled: false }); // must never switch itself on
  await store.addShown('abc');
  await store.setSettings({ share: 50 });
  assert.equal(await store.getSubs('UC1'), undefined);
  store.onChange(() => {});
});

test('a working extension context is alive', () => {
  const { store } = make();
  assert.equal(store.isAlive(), true);
});
