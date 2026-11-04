import test from 'node:test';
import assert from 'node:assert/strict';
import { read } from './helpers.js';
import '../../extension/src/youtube.js';
import '../../extension/src/content/api.js';

const { createApi } = globalThis.SmallYT?.api ?? {};

const setup = () => {
  const calls = [];
  const queue = { kinds: [], run: async (kind, fn) => { queue.kinds.push(kind); return fn(); } };
  const fetchFn = async (url, init) => {
    calls.push({ url, ...init, json: init.body ? JSON.parse(init.body) : null });
    let body = '{}';
    if (url.includes('/youtubei/v1/search')) body = read('search.en.json');
    if (url.includes('/youtubei/v1/next')) body = read('next.en.json');
    if (url.includes('/youtubei/v1/browse')) body = read('browse.en.json');
    if (url.includes('/youtubei/v1/player')) body = read('player.en.json');
    if (url.startsWith('/results')) body = read('results.ru.html');
    if (url.startsWith('/watch')) body = read('watch.dub-default.html');
    return { status: 200, url: 'https://www.youtube.com' + url, text: async () => body };
  };
  const api = createApi({ queue, fetchFn, context: { clientVersion: '2.2026', hl: 'ru', gl: 'RU' } });
  return { api, calls, queue, last: () => calls[calls.length - 1] };
};

test('search without an account uses no cookies and returns two pages', async () => {
  const { api, calls, queue } = setup();
  const results = await api.search('x', false);
  assert.ok(results.length >= 5);
  assert.ok(calls.every(c => c.credentials === 'omit' && c.url.includes('/youtubei/v1/search')));
  assert.equal(calls.length, 2);
  assert.ok(calls[1].json.continuation);
  assert.equal(calls[0].json.context.client.hl, 'ru');
  assert.equal(calls[0].json.params, 'EgIQAQ==');
  assert.ok(queue.kinds.every(k => k === 'plain'));
});

test('channel and tag lookups use no cookies', async () => {
  const { api, last } = setup();
  assert.ok((await api.subscribers('UC1')) > 0);
  assert.equal(last().credentials, 'omit');
  assert.equal(last().json.context.client.hl, 'en');
  assert.ok((await api.tags('v')).length > 0);
  assert.equal(last().credentials, 'omit');
});

test('related without an account uses no cookies', async () => {
  const { api, last } = setup();
  assert.ok((await api.related('v', false)).length > 0);
  assert.equal(last().credentials, 'omit');
});

test('page fetches use the account and the slow lane', async () => {
  const { api, last, queue } = setup();
  const info = await api.watchInfo('v');
  assert.ok(info.tracks.length > 0);
  assert.equal(last().credentials, 'include');
  assert.ok(last().url.includes('/watch?v=v'));
  assert.deepEqual(queue.kinds, ['account']);
});

test('account mode searches through full pages', async () => {
  const { api, last, queue } = setup();
  assert.ok((await api.search('x y', true)).length >= 1);
  assert.equal(last().credentials, 'include');
  assert.ok(last().url.includes('/results?search_query=x%20y'));
  await api.related('v', true);
  assert.equal(last().credentials, 'include');
  assert.ok(queue.kinds.every(k => k === 'account'));
});

test('an unreadable response gives an empty result', async () => {
  const queue = { run: async (kind, fn) => fn() };
  const fetchFn = async () => ({ status: 200, url: 'https://www.youtube.com/', text: async () => 'not json' });
  const api = createApi({ queue, fetchFn, context: { clientVersion: '1', hl: 'en', gl: 'US' } });
  assert.deepEqual(await api.search('x', false), []);
  assert.deepEqual(await api.related('v', false), []);
  assert.equal(await api.subscribers('UC1'), null);
  assert.equal(await api.watchInfo('v'), null);
});

test('page fetches never follow a redirect to another site', async () => {
  const calls = [];
  const queue = { run: async (kind, fn) => fn() };
  const fetchFn = async (url, init) => {
    calls.push(init);
    return { status: 0, type: 'opaqueredirect', url: '', text: async () => '' };
  };
  const api = createApi({ queue, fetchFn, context: { clientVersion: '1', hl: 'en', gl: 'US' } });
  assert.equal(await api.watchInfo('v'), null);
  assert.deepEqual(await api.search('x', true), []);
  assert.ok(calls.every(c => c.redirect === 'manual'));
});

test('a redirect is reported to the queue', async () => {
  let seen = null;
  const queue = { run: async (kind, fn) => { seen = await fn(); return seen; } };
  const fetchFn = async () => ({ status: 0, type: 'opaqueredirect', url: '', text: async () => '' });
  const api = createApi({ queue, fetchFn, context: { clientVersion: '1', hl: 'en', gl: 'US' } });
  await api.watchInfo('v');
  assert.equal(seen.redirected, true);
});
