import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeChrome, fakeClock } from './helpers.js';
import '../../extension/src/lib/settings.js';
import '../../extension/src/content/store.js';
import '../../extension/src/content/queue.js';

const { createStore } = globalThis.SmallYT?.store ?? {};
const { createQueue } = globalThis.SmallYT?.queue ?? {};

const fresh = (options = {}) => {
  const clock = fakeClock();
  const store = createStore(fakeChrome(), clock.now);
  const q = createQueue({ store, now: clock.now, sleep: clock.sleep, isVisible: () => true, ...options });
  return { clock, store, q };
};
const ok = async () => ({ status: 200, finalUrl: 'https://www.youtube.com/x', body: '{}' });
const tick = () => new Promise(setImmediate);
const today = clock => new Date(clock.now()).toISOString().slice(0, 10);
const THIRTY_MINUTES = 30 * 60 * 1000;

const runMany = async (q, clock, kind, count) => {
  const starts = [];
  let active = 0;
  let maxConcurrent = 0;
  const tasks = Array.from({ length: count }, () => q.run(kind, async () => {
    starts.push(clock.now());
    active++;
    maxConcurrent = Math.max(maxConcurrent, active);
    await tick();
    await tick();
    active--;
    return { status: 200, body: '' };
  }));
  await Promise.all(tasks);
  return { starts, maxConcurrent };
};
const maxInAnySecond = starts => Math.max(...starts.map(s => starts.filter(x => x >= s && x < s + 1000).length));
const minGap = starts => Math.min(...starts.slice(1).map((s, i) => s - starts[i]));

test('plain requests: 3 per second, 3 at once', async () => {
  const { q, clock } = fresh();
  const { starts, maxConcurrent } = await runMany(q, clock, 'plain', 10);
  assert.equal(starts.length, 10);
  assert.ok(maxInAnySecond(starts) <= 3, `saw ${maxInAnySecond(starts)}`);
  assert.ok(maxConcurrent <= 3);
});

test('account requests: 1 per 2 seconds, 1 at a time', async () => {
  const { q, clock } = fresh();
  const { starts, maxConcurrent } = await runMany(q, clock, 'account', 4);
  assert.ok(minGap(starts) >= 2000);
  assert.equal(maxConcurrent, 1);
});

test('daily budget is shared and stops at 3000', async () => {
  const { q, store, clock } = fresh();
  await store.setState('budget', { day: today(clock), used: 3000 });
  await assert.rejects(q.run('plain', ok), { reason: 'budget' });
});

test('the daily limit comes from the settings', async () => {
  const { q, store, clock } = fresh();
  await store.setSettings({ dailyRequests: 1000 });
  await store.setState('budget', { day: today(clock), used: 999 });
  await q.run('plain', ok);
  await assert.rejects(q.run('plain', ok), { reason: 'budget' });
});

test('with no daily limit, requests are counted but never stopped', async () => {
  const { q, store, clock } = fresh();
  await store.setSettings({ dailyRequests: null });
  await store.setState('budget', { day: today(clock), used: 1e6 });
  await q.run('plain', ok);
  assert.equal((await store.getState('budget')).used, 1e6 + 1);
});

test('raising the daily limit lifts the stop right away', async () => {
  const { q, store, clock } = fresh();
  await store.setState('budget', { day: today(clock), used: 3000 });
  await assert.rejects(q.run('plain', ok), { reason: 'budget' });
  assert.equal(q.isHalted(), true);
  const changes = [];
  q.onPauseChange(halted => changes.push(halted));
  await store.setSettings({ dailyRequests: 5000 });
  assert.equal(q.isHalted(), false);
  assert.deepEqual(changes, [false]);
  await q.run('plain', ok);
});

test('changing another setting does not lift the daily stop', async () => {
  const { q, store, clock } = fresh();
  await store.setState('budget', { day: today(clock), used: 3000 });
  await assert.rejects(q.run('plain', ok), { reason: 'budget' });
  await store.setSettings({ share: 50 });
  assert.equal(q.isHalted(), true);
});

test('budget counts requests and resets the next day', async () => {
  const { q, store, clock } = fresh();
  await q.run('plain', ok);
  assert.equal((await store.getState('budget')).used, 1);
  await store.setState('budget', { day: '2000-01-01', used: 3000 });
  await q.run('plain', ok);
  assert.equal((await store.getState('budget')).used, 1);
  assert.equal((await store.getState('budget')).day, today(clock));
});

test('403, 429 and captcha pause for 30 minutes across tabs', async () => {
  const signs = [
    { status: 403 },
    { status: 429 },
    { status: 200, finalUrl: 'https://www.google.com/sorry/index', body: '' },
    { status: 200, finalUrl: 'https://www.youtube.com/x', body: '<div class="g-recaptcha"></div>' },
  ];
  for (const r of signs) {
    const { q, store, clock } = fresh();
    await assert.rejects(q.run('plain', async () => r), { reason: 'paused' });
    assert.equal(await store.getState('pausedUntil'), clock.now() + THIRTY_MINUTES);
    assert.equal(q.isPaused(), true);
    await assert.rejects(q.run('plain', ok), { reason: 'paused' });
  }
});

test('a pause set by another tab applies here, and ends after 30 minutes', async () => {
  const { q, store, clock } = fresh();
  const seen = [];
  q.onPauseChange(v => seen.push(v));
  await store.setState('pausedUntil', clock.now() + THIRTY_MINUTES);
  await tick();
  assert.equal(q.isPaused(), true);
  assert.deepEqual(seen, [true]);
  let called = 0;
  await assert.rejects(q.run('plain', async () => { called++; return { status: 200 }; }), { reason: 'paused' });
  assert.equal(called, 0);
  clock.advance(THIRTY_MINUTES + 1);
  assert.equal(q.isPaused(), false);
  await q.run('plain', ok);
});

test('404 skips without pausing', async () => {
  const { q } = fresh();
  await assert.rejects(q.run('plain', async () => ({ status: 404 })), { reason: 'skip' });
  assert.equal(q.isPaused(), false);
});

test('3 server errors in a row pause, a success resets the count', async () => {
  const { q } = fresh();
  const fail = async () => ({ status: 503 });
  await assert.rejects(q.run('plain', fail), { reason: 'skip' });
  await assert.rejects(q.run('plain', fail), { reason: 'skip' });
  await q.run('plain', ok);
  await assert.rejects(q.run('plain', fail), { reason: 'skip' });
  await assert.rejects(q.run('plain', fail), { reason: 'skip' });
  assert.equal(q.isPaused(), false);
  await assert.rejects(q.run('plain', fail), { reason: 'paused' });
  assert.equal(q.isPaused(), true);
});

test('a thrown fetch counts as a server error', async () => {
  const { q } = fresh();
  await assert.rejects(q.run('plain', async () => { throw new Error('offline'); }), { reason: 'skip' });
  assert.equal(q.isPaused(), false);
});

test('a hidden tab holds its requests until visible', async () => {
  let visible = false;
  const { q } = fresh({ isVisible: () => visible });
  let called = 0;
  const running = q.run('plain', async () => { called++; return { status: 200 }; });
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(called, 0);
  visible = true;
  await running;
  assert.equal(called, 1);
});

const redirected = async () => ({ status: 0, redirected: true, body: '' });

test('a redirected page fetch comes back as an empty page, without pausing', async () => {
  const { q } = fresh();
  for (let i = 0; i < 4; i++) {
    const response = await q.run('account', redirected);
    assert.equal(response.body, '');
  }
  assert.equal(q.isPaused(), false);
});

test('a success resets the redirect count', async () => {
  const { q } = fresh();
  for (let i = 0; i < 4; i++) await q.run('account', redirected);
  await q.run('account', ok);
  for (let i = 0; i < 4; i++) await q.run('account', redirected);
  assert.equal(q.isPaused(), false);
});

test('every page redirecting pauses, because it may be a captcha', async () => {
  const { q } = fresh();
  for (let i = 0; i < 4; i++) await q.run('account', redirected);
  await assert.rejects(q.run('account', redirected), { reason: 'paused' });
  assert.equal(q.isPaused(), true);
});
