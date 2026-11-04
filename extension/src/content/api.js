// The requests themselves. Only the browser ever sends cookies, and only page fetches ask it to.
(() => {
  const yt = globalThis.SmallYT.yt;

  const createApi = ({ queue, fetchFn, context }) => {
    const parseJson = text => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    };

    const post = async (endpoint, payload, hl = context.hl) => {
      const response = await queue.run('plain', async () => {
        const r = await fetchFn(endpoint, {
          method: 'POST',
          credentials: 'omit',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            context: { client: { clientName: 'WEB', clientVersion: context.clientVersion, hl, gl: context.gl } },
            ...payload,
          }),
        });
        return { status: r.status, finalUrl: r.url, body: await r.text() };
      });
      return parseJson(response.body);
    };

    const page = async url => {
      const response = await queue.run('account', async () => {
        const r = await fetchFn(url, { credentials: 'include' });
        return { status: r.status, finalUrl: r.url, body: await r.text() };
      });
      return response.body;
    };

    const search = async (query, useAccount) => {
      if (useAccount) return yt.parseSearchPage(await page(yt.ENDPOINTS.results(query)), context.hl);
      const first = await post(yt.ENDPOINTS.search, { query, params: yt.VIDEO_FILTER });
      const results = yt.parseSearch(first, context.hl);
      const token = yt.continuationToken(first);
      if (!token) return results;
      try {
        return [...results, ...yt.parseSearch(await post(yt.ENDPOINTS.search, { continuation: token }), context.hl)];
      } catch {
        return results; // the first page is still useful
      }
    };

    const related = async (videoId, useAccount) => {
      if (useAccount) return yt.parseWatchRelated(await page(yt.ENDPOINTS.watch(videoId)), context.hl);
      return yt.parseNext(await post(yt.ENDPOINTS.next, { videoId }), context.hl);
    };

    // Asked in English on purpose, so only one number format needs parsing.
    const subscribers = async channelId => yt.parseSubscribers(
      await post(yt.ENDPOINTS.browse, { browseId: channelId, params: yt.CHANNEL_VIDEOS_TAB }, 'en'),
    );

    const tags = async videoId => yt.parseTags(await post(yt.ENDPOINTS.player, { videoId }));

    const watchInfo = async videoId => yt.parseWatchPage(await page(yt.ENDPOINTS.watch(videoId)));

    return { search, related, subscribers, tags, watchInfo };
  };

  (globalThis.SmallYT ??= {}).api = { createApi };
})();
