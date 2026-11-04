// Keeps requests well below anything that could bother YouTube or show the user a captcha.
// YouTube publishes no limits for these requests, so these numbers are deliberately conservative.
(() => {
  const PAUSE_MS = 30 * 60 * 1000;
  const DAILY_BUDGET = 3000;
  const SERVER_ERRORS_TO_PAUSE = 3;
  const REDIRECTS_TO_PAUSE = 5;
  const HIDDEN_TAB_POLL_MS = 500;
  const CAPTCHA_PAGE_MAX_LENGTH = 100000; // real YouTube pages are far larger than a captcha page

  const fail = reason => Object.assign(new Error(reason), { reason });

  const classifyResponse = ({ status, finalUrl, body }) => {
    if (status === 403 || status === 429) return 'pause';
    if (/\/sorry\//.test(finalUrl ?? '')) return 'pause';
    if (typeof body === 'string' && body.length < CAPTCHA_PAGE_MAX_LENGTH && body.includes('g-recaptcha')) return 'pause';
    if (status === 0 || status >= 500) return 'server-error';
    if (status >= 400) return 'skip';
    return 'ok';
  };

  const createQueue = ({ store, now, sleep, isVisible }) => {
    const lane = (gap, max) => ({ gap, max, active: 0, nextAt: 0, tail: Promise.resolve(), waiters: [] });
    const lanes = { plain: lane(334, 3), account: lane(2000, 1) };
    const listeners = [];
    let pausedUntil = 0;
    let budgetOutDay = null;
    let serverErrors = 0;
    let redirects = 0;
    let lastHalted = false;

    const today = () => new Date(now()).toISOString().slice(0, 10);
    const isPaused = () => now() < pausedUntil;
    const isHalted = () => {
      const halted = isPaused() || budgetOutDay === today();
      if (halted !== lastHalted) {
        lastHalted = halted;
        for (const fn of listeners) fn(halted);
      }
      return halted;
    };
    const setPausedUntil = until => {
      pausedUntil = until ?? 0;
      isHalted();
    };
    Promise.resolve(store.getState('pausedUntil')).then(until => { if (until) setPausedUntil(until); });
    store.onChange(changes => { if (changes.pausedUntil) setPausedUntil(changes.pausedUntil.newValue); });

    const pauseNow = async () => {
      const until = now() + PAUSE_MS;
      await store.setState('pausedUntil', until);
      setPausedUntil(until);
    };

    const charge = async () => {
      const day = today();
      const budget = await store.getState('budget');
      const used = budget?.day === day ? budget.used : 0;
      if (used >= DAILY_BUDGET) {
        budgetOutDay = day;
        isHalted();
        throw fail('budget');
      }
      await store.setState('budget', { day, used: used + 1 });
    };

    const release = l => {
      l.active--;
      l.waiters.shift()?.();
    };

    const run = async (kind, fn) => {
      if (isPaused()) throw fail('paused');
      const l = lanes[kind];
      const turn = l.tail.then(async () => {
        while (!isVisible()) await sleep(HIDDEN_TAB_POLL_MS);
        while (l.active >= l.max) await new Promise(resolve => l.waiters.push(resolve));
        const wait = l.nextAt - now();
        if (wait > 0) await sleep(wait);
        l.active++;
        try {
          if (isPaused()) throw fail('paused');
          await charge();
          l.nextAt = now() + l.gap;
        } catch (err) {
          release(l);
          throw err;
        }
      });
      l.tail = turn.catch(() => {});
      await turn;
      try {
        let response;
        try {
          response = await fn();
        } catch {
          response = { status: 0 };
        }
        // A consent page redirects like this, and so may a captcha. It can't be told which, so a
        // few count as an unreadable page, but every page redirecting means it's time to stop.
        if (response.redirected) {
          redirects++;
          if (redirects >= REDIRECTS_TO_PAUSE) {
            redirects = 0;
            await pauseNow();
            throw fail('paused');
          }
          return response;
        }
        redirects = 0;
        const verdict = classifyResponse(response);
        if (verdict === 'pause') {
          await pauseNow();
          throw fail('paused');
        }
        if (verdict === 'server-error') {
          serverErrors++;
          if (serverErrors >= SERVER_ERRORS_TO_PAUSE) {
            serverErrors = 0;
            await pauseNow();
            throw fail('paused');
          }
          throw fail('skip');
        }
        serverErrors = 0;
        if (verdict === 'skip') throw fail('skip');
        return response;
      } finally {
        release(l);
      }
    };

    return { run, isPaused, isHalted, onPauseChange: fn => listeners.push(fn) };
  };

  (globalThis.SmallYT ??= {}).queue = { createQueue, classifyResponse };
})();
