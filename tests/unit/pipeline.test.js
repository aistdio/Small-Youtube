import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeChrome, load } from './helpers.js';
import '../../extension/src/youtube.js';
import '../../extension/src/lib/settings.js';
import '../../extension/src/lib/topic.js';
import '../../extension/src/lib/language.js';
import '../../extension/src/content/store.js';
import '../../extension/src/content/pipeline.js';

const yt = globalThis.SmallYT?.yt ?? {};
const { DEFAULTS } = globalThis.SmallYT?.settings ?? {};
const { createStore } = globalThis.SmallYT?.store ?? {};
const { createPipeline } = globalThis.SmallYT?.pipeline ?? {};

const seed = { id: 'seedvideo01', title: 'Epic Seven Steam launch review', channelName: 'Seed Channel' };
const settings = { ...DEFAULTS, languages: ['en', 'ru'], viewsMin: 0, viewsMax: null, subsMin: 10, subsMax: 10000 };
const labels = ['Less of this topic', 'Hide this channel'];
const english = { title: 'Real title', tracks: [], autoCaptions: ['en'] };
const dub = { title: 'Dubbed', tracks: [{ id: 'en-US.10', isDefault: true }], autoCaptions: ['en'] };

// Candidates based on real related-list cards, so cards built from them are realistic.
const realRelated = (count = null) => {
  const parsed = yt.parseNext(load('next.en.json'), 'en');
  const real = Array.from({ length: count ?? parsed.length }, (_, i) => parsed[i % parsed.length]);
  return real.map((c, i) => ({
    ...c,
    id: `related${String(i).padStart(4, '0')}`,
    channelId: `UC${String(i).padStart(22, '0')}`,
    channelName: `Channel ${i}`,
    views: 1000 + i,
    lengthSeconds: 600,
    isShort: false,
    autoDubbedLabel: false,
    title: i === 0 ? 'Unrelated pottery class' : `Epic Seven story ${i}`,
    lockup: { ...c.lockup, contentId: `related${String(i).padStart(4, '0')}` },
  }));
};

const setup = (over = {}) => {
  const calls = { search: 0, related: 0, subscribers: [], tags: 0, watchInfo: [] };
  const api = {
    search: async () => { calls.search++; return over.searchResults ?? []; },
    related: async () => { calls.related++; return over.relatedResults ?? realRelated(); },
    subscribers: async id => { calls.subscribers.push(id); return over.subs ? over.subs(id) : 500; },
    tags: async () => { calls.tags++; return over.tags ?? ['Epic Seven']; },
    watchInfo: async id => { calls.watchInfo.push(id); return over.watchInfo ? over.watchInfo(id, calls.watchInfo.length) : english; },
  };
  const store = createStore(fakeChrome(), Date.now);
  const rng = over.rng ?? (() => 0);
  return { calls, store, p: createPipeline({ api, store, rng, context: { hl: 'en' } }) };
};

test('returns a card titled from the language-check page', async () => {
  const { p, calls } = setup();
  const card = await p.findCard(seed, settings, labels);
  assert.equal(card.lockup.metadata.lockupMetadataViewModel.title.content, 'Real title');
  assert.equal(calls.watchInfo.length, 1);
  assert.equal(card.videoId, card.lockup.contentId);
  assert.ok(card.channelId && card.channelName);
  assert.equal(card.seed, seed);
});

test('the card carries the menu entries', async () => {
  const { p } = setup();
  const card = await p.findCard(seed, settings, labels);
  assert.ok(JSON.stringify(card.lockup).includes('Hide this channel'));
});

test('looks up at most 8 new channels per card', async () => {
  const { p, calls } = setup({ subs: () => 1e6, relatedResults: realRelated(12) }); // nothing fits, so it would keep looking
  assert.equal(await p.findCard(seed, settings, labels), null);
  assert.equal(calls.subscribers.length, 8);
});

test('cached channels do not count toward the 8', async () => {
  const relatedResults = realRelated(14);
  const { p, calls, store } = setup({ subs: () => 1e6, relatedResults });
  const cached = relatedResults.slice(1, 4);
  for (const c of cached) await store.setSubs(c.channelId, 1e6);
  await p.findCard(seed, settings, labels);
  assert.equal(calls.subscribers.length, 8);
  for (const c of cached) assert.ok(!calls.subscribers.includes(c.channelId));
});

test('subscriber counts are cached, including hidden ones', async () => {
  const { p, store } = setup({ subs: id => (id.endsWith('1') ? null : 500) });
  await p.findCard(seed, settings, labels);
  const hidden = realRelated().find(c => c.channelId.endsWith('1'));
  assert.equal(await store.getSubs(hidden.channelId), null);
});

test('channels that hide their count are dropped', async () => {
  const { p } = setup({ subs: () => null });
  assert.equal(await p.findCard(seed, settings, labels), null);
});

test('on-topic candidates are looked up first', async () => {
  const { p, calls } = setup();
  await p.findCard(seed, settings, labels);
  assert.notEqual(calls.subscribers[0], realRelated()[0].channelId); // the off-topic one comes first in the list
});

test('a failed language check moves to the next in the ranking', async () => {
  const { p, calls } = setup({ watchInfo: (id, n) => (n === 1 ? dub : english) });
  const card = await p.findCard(seed, settings, labels);
  assert.equal(calls.watchInfo.length, 2);
  assert.ok(card);
  assert.equal(card.videoId, calls.watchInfo[1]);
});

test('a candidate already labelled auto-dubbed spends no page fetch', async () => {
  const relatedResults = realRelated().map(c => ({ ...c, autoDubbedLabel: true }));
  const { p, calls } = setup({ relatedResults });
  assert.equal(await p.findCard(seed, settings, labels), null);
  assert.equal(calls.watchInfo.length, 0);
});

test('a consent page counts as unknown and does not throw', async () => {
  const { p, calls } = setup({ watchInfo: () => null });
  assert.equal(await p.findCard(seed, settings, labels), null);
  assert.ok(calls.watchInfo.length >= 1);
});

test('the same seed reuses its pool', async () => {
  const { p, calls } = setup();
  const a = await p.findCard(seed, settings, labels);
  const b = await p.findCard(seed, settings, labels);
  assert.equal(calls.search, 1);
  assert.equal(calls.related, 1);
  assert.equal(calls.tags, 1);
  assert.notEqual(a.videoId, b.videoId);
});

test('search results become cards through a related-list template', async () => {
  const searchResults = yt.parseSearch(load('search.en.json'), 'en')
    .filter(c => c.lengthSeconds >= 60 && typeof c.views === 'number')
    .map(c => ({ ...c, views: 700 }));
  const { p } = setup({ searchResults, relatedResults: realRelated().slice(0, 1).map(c => ({ ...c, title: 'Unrelated pottery class' })), rng: () => 0 });
  const card = await p.findCard(seed, settings, labels);
  assert.ok(searchResults.some(c => c.id === card.videoId));
  assert.equal(card.lockup.contentId, card.videoId);
});

test('search results are dropped when no template exists', async () => {
  const searchResults = yt.parseSearch(load('search.en.json'), 'en');
  const { p } = setup({ searchResults, relatedResults: [] });
  assert.equal(await p.findCard(seed, settings, labels), null);
});

test('a pause or budget rejection ends quietly', async () => {
  const stop = async () => { throw Object.assign(new Error('paused'), { reason: 'paused' }); };
  const api = { search: stop, related: stop, tags: stop, subscribers: stop, watchInfo: stop };
  const p = createPipeline({ api, store: createStore(fakeChrome(), Date.now), rng: () => 0, context: { hl: 'en' } });
  assert.equal(await p.findCard(seed, settings, labels), null);
});

test('one failed list does not lose the other', async () => {
  const api = {
    search: async () => { throw Object.assign(new Error('skip'), { reason: 'skip' }); },
    related: async () => realRelated(),
    tags: async () => { throw Object.assign(new Error('skip'), { reason: 'skip' }); },
    subscribers: async () => 500,
    watchInfo: async () => english,
  };
  const p2 = createPipeline({ api, store: createStore(fakeChrome(), Date.now), rng: () => 0, context: { hl: 'en' } });
  assert.ok(await p2.findCard(seed, settings, labels));
});

test('language checks per card are capped', async () => {
  const { p, calls } = setup({ watchInfo: () => null, relatedResults: realRelated(12) });
  assert.equal(await p.findCard(seed, settings, labels), null);
  assert.equal(calls.watchInfo.length, 4);
});

test('a rejected video is not checked again for the next card', async () => {
  const { p, calls } = setup({ watchInfo: (id, n) => (n === 1 ? dub : english) });
  await p.findCard(seed, settings, labels);
  await p.findCard(seed, settings, labels);
  assert.equal(new Set(calls.watchInfo).size, calls.watchInfo.length);
});

test('a shown video is not offered again', async () => {
  const { p, store } = setup();
  const first = await p.findCard(seed, settings, labels);
  assert.ok((await store.getShown()).has(first.videoId));
  const other = setup();
  await other.store.addShown(first.videoId);
  const second = await other.p.findCard(seed, settings, labels);
  assert.notEqual(second.videoId, first.videoId);
});

test('hidden channels and muted topics are respected', async () => {
  const { p, store } = setup();
  for (const c of realRelated()) await store.hideChannel(c.channelId, c.channelName);
  assert.equal(await p.findCard(seed, settings, labels), null);
  const muted = setup();
  await muted.store.muteTopic('Epic Seven');
  const card = await muted.p.findCard({ ...seed, title: 'Something else', id: 'x' }, settings, labels);
  assert.equal(card.videoId, 'related0000'); // the only title without the muted phrase
});

const lastPartOfViewsRow = card => card.lockup.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows[1].metadataParts.at(-1).text.content;

test('the card carries the Small Creator label when the setting is on', async () => {
  const { p } = setup();
  const card = await p.findCard(seed, settings, labels, 'Small Creator');
  assert.equal(lastPartOfViewsRow(card), 'Small Creator');
});

test('the card has no label when the setting is off', async () => {
  const { p } = setup();
  const card = await p.findCard(seed, { ...settings, showSmallCreatorLabel: false }, labels, 'Small Creator');
  assert.ok(!JSON.stringify(card.lockup).includes('Small Creator'));
});

test('the card knows the title it shows, for the watched list', async () => {
  const { p } = setup();
  const card = await p.findCard(seed, settings, labels);
  assert.equal(card.title, 'Real title');
});

test('a banned word skips videos whose title has it, whatever the case', async () => {
  const { p, store } = setup();
  await store.banWord('EPIC seven');
  const card = await p.findCard({ ...seed, title: 'Something else', id: 'x' }, settings, labels);
  assert.equal(card.videoId, 'related0000'); // the only title without the banned words
});

test('a banned word must match exactly, so part of a word does not count', async () => {
  const { p, store } = setup();
  await store.banWord('Sev');
  const card = await p.findCard({ ...seed, title: 'Something else', id: 'x' }, settings, labels);
  assert.notEqual(card.videoId, 'related0000'); // on-topic "Epic Seven story" titles are still allowed
});

test('a banned word in the title the card would show also skips the video', async () => {
  const { p, store, calls } = setup({
    watchInfo: (id, nth) => ({ ...english, title: nth === 1 ? 'A forbidden title' : 'Clean title' }),
  });
  await store.banWord('Forbidden');
  const card = await p.findCard(seed, settings, labels);
  assert.equal(card.title, 'Clean title');
  assert.equal(calls.watchInfo.length, 2);
});

test('a seed with a banned word costs no requests', async () => {
  const { p, calls, store } = setup();
  await store.banWord('epic seven');
  assert.equal(await p.findCard(seed, settings, labels), null);
  assert.equal(calls.related + calls.search + calls.tags, 0);
});

const { handleLessTopic, seedAllowed } = globalThis.SmallYT?.pipeline ?? {};

test('less of this topic mutes the best phrase', async () => {
  const store = createStore(fakeChrome(), Date.now);
  await handleLessTopic({ seed: { title: 'Epic Seven launch', channelName: 'N' }, tags: ['Epic Seven'] }, store);
  assert.deepEqual((await store.getBlocks()).phrases, ['Epic Seven']);
  assert.deepEqual((await store.getBlocks()).seedChannels, []);
});

test('with no clear phrase it stops using the seed channel', async () => {
  const store = createStore(fakeChrome(), Date.now);
  await handleLessTopic({ seed: { title: 'i humbly submit a toast', channelName: 'yuyu' }, tags: [] }, store);
  assert.deepEqual((await store.getBlocks()).seedChannels, ['yuyu']);
  assert.deepEqual((await store.getBlocks()).phrases, []);
});

test('muted topics and seed channels stop seeds', () => {
  assert.equal(seedAllowed({ title: 'Epic Seven news', channelName: 'A' }, { phrases: ['Epic Seven'], seedChannels: [], words: [] }), false);
  assert.equal(seedAllowed({ title: 'Other', channelName: 'yuyu' }, { phrases: [], seedChannels: ['yuyu'], words: [] }), false);
  assert.equal(seedAllowed({ title: 'Epic Seven news', channelName: 'A' }, { phrases: [], seedChannels: [], words: ['seven'] }), false);
  assert.equal(seedAllowed({ title: 'Other', channelName: 'A' }, { phrases: ['Epic Seven'], seedChannels: ['yuyu'], words: ['seven'] }), true);
});

test('a blocked seed costs no requests', async () => {
  const { p, calls, store } = setup();
  await store.muteSeedChannel(seed.channelName);
  assert.equal(await p.findCard(seed, settings, labels), null);
  assert.equal(calls.related + calls.search + calls.tags, 0);
});

test('tags for a seed come from memory when known', async () => {
  const { p, calls } = setup();
  await p.findCard(seed, settings, labels);
  assert.deepEqual(await p.tagsFor(seed), ['Epic Seven']);
  assert.equal(calls.tags, 1);
  assert.deepEqual(await p.tagsFor({ id: 'other' }), ['Epic Seven']);
  assert.equal(calls.tags, 2);
});
