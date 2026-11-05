// The page-world side of the bridge. Only this world can read YouTube's config and render cards.
(() => {
  const { feed, cards, languages } = globalThis.SmallYT;
  const NS = 'small-yt';
  const CONFIG_POLL_MS = 300;
  const CARD_MARK = 'data-small-yt';
  let labels = [];
  let readingLanguages = false;

  const send = (type, data = {}) => window.postMessage({ ns: NS, from: 'page', type, ...data }, location.origin);

  const readLanguages = async () => {
    if (readingLanguages) return;
    readingLanguages = true;
    const codes = await languages.readAccountLanguages();
    readingLanguages = false;
    if (codes) send('languages', { codes, hl: window.ytcfg?.get?.('HL') });
    else send('languagesFailed');
  };

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
    if (e.data.type === 'config') {
      labels = e.data.labels ?? labels;
      feed.applyConfig(e.data);
      if (e.data.readLanguages) readLanguages();
    }
    if (e.data.type === 'card' || e.data.type === 'noCard') feed.onCard(e.data);
  });

  cards.installMenu({
    cardMark: CARD_MARK,
    getLabels: () => labels,
    onLessTopic: (el, card) => {
      send('lessTopic', { seed: card.seed });
      feed.removeCards([el]);
    },
    onHideChannel: card => {
      send('hideChannel', { channelId: card.channelId, channelName: card.channelName });
      feed.removeCards(feed.smallCards().filter(el => cards.recall(el)?.channelId === card.channelId));
    },
  });

  cards.installWatchTracker({
    cardMark: CARD_MARK,
    onWatch: card => send('watched', { videoId: card.videoId, title: card.title, channelName: card.channelName }),
  });

  feed.start(send);
  sendContext();
})();
