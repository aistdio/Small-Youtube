// The page-world side of the bridge. Only this world can read YouTube's config and render cards.
(() => {
  const { feed } = globalThis.SmallYT;
  const NS = 'small-yt';
  const CONFIG_POLL_MS = 300;

  const send = (type, data = {}) => window.postMessage({ ns: NS, from: 'page', type, ...data }, location.origin);

  const sendContext = () => {
    const cfg = window.ytcfg;
    if (!cfg?.get?.('INNERTUBE_CLIENT_VERSION')) {
      setTimeout(sendContext, CONFIG_POLL_MS);
      return;
    }
    send('context', {
      clientVersion: cfg.get('INNERTUBE_CLIENT_VERSION'),
      hl: cfg.get('HL') ?? 'en',
      gl: cfg.get('GL') ?? 'US',
      loggedIn: !!cfg.get('LOGGED_IN'),
    });
  };

  window.addEventListener('message', e => {
    if (e.source !== window || e.data?.ns !== NS || e.data.from !== 'content') return;
    if (e.data.type === 'hello') sendContext();
    if (e.data.type === 'config') feed.applyConfig(e.data);
    if (e.data.type === 'card' || e.data.type === 'noCard') feed.onCard(e.data);
  });

  feed.start(send);
  sendContext();
})();
