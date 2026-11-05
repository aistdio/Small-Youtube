// Turns one seed video into one finished small-creator card, following the steps in the design:
// collect candidates, filter, check subscribers, rank, check language, build the card.
(() => {
  const { yt, topic, language } = globalThis.SmallYT;

  const MAX_LOOKUPS_PER_CARD = 8;
  const ENOUGH_KNOWN_FITS = 3; // the ranking picks among the top 3
  const MAX_LANGUAGE_CHECKS_PER_CARD = 4;
  const MAX_POOLS = 100;

  const reasonOf = err => err?.reason;
  const isSkip = err => reasonOf(err) === 'skip';
  const orEmptyOnSkip = fallback => err => {
    if (isSkip(err)) return fallback;
    throw err;
  };

  const mutedTerms = blocks => [...blocks.phrases, ...blocks.words];
  const hasMutedTerm = (title, blocks) => mutedTerms(blocks).some(term => topic.matchesPhrase(title, term));
  const seedAllowed = (seed, blocks) => !blocks.seedChannels.includes(seed.channelName) && !hasMutedTerm(seed.title, blocks);

  const createPipeline = ({ api, store, rng, context }) => {
    const pools = new Map();
    const tried = new Set(); // videos already checked or chosen, so parallel cards can't pick the same one

    const buildPool = async (seed, settings) => {
      const useAccount = settings.useAccountForSearches;
      const tags = await api.tags(seed.id).catch(orEmptyOnSkip([]));
      const query = topic.buildQuery(seed.title, seed.channelName, tags);
      const [related, searched] = await Promise.all([
        api.related(seed.id, useAccount).catch(orEmptyOnSkip([])),
        query ? api.search(query, useAccount).catch(orEmptyOnSkip([])) : [],
      ]);
      const byId = new Map();
      for (const c of [...related, ...searched]) if (!byId.has(c.id)) byId.set(c.id, c);
      return {
        tags,
        terms: topic.topicTerms(seed.title, seed.channelName, tags),
        template: yt.pickTemplate(related),
        candidates: [...byId.values()],
        usedChannels: new Set(),
      };
    };

    const poolFor = (seed, settings) => {
      if (!pools.has(seed.id)) {
        if (pools.size >= MAX_POOLS) pools.delete(pools.keys().next().value);
        const pool = buildPool(seed, settings);
        pools.set(seed.id, pool);
        pool.catch(() => pools.delete(seed.id));
      }
      return pools.get(seed.id);
    };

    // Lookups all start at once: the request queue sets their pace, so this only removes waiting.
    const withSubscribers = async (candidates, settings) => {
      const channelIds = [...new Set(candidates.map(c => c.channelId))];
      const known = await Promise.all(channelIds.map(id => store.getSubs(id)));
      const subsOf = new Map(channelIds.map((id, i) => [id, known[i]]));
      const fits = () => candidates
        .filter(c => topic.inSubscriberRange(subsOf.get(c.channelId), settings))
        .map(c => ({ ...c, subs: subsOf.get(c.channelId) }));
      if (fits().length >= ENOUGH_KNOWN_FITS) return fits();

      const unknown = channelIds.filter(id => subsOf.get(id) === undefined).slice(0, MAX_LOOKUPS_PER_CARD);
      await Promise.all(unknown.map(async id => {
        try {
          const subs = await api.subscribers(id);
          subsOf.set(id, subs);
          await store.setSubs(id, subs);
        } catch (err) {
          if (!isSkip(err)) throw err;
        }
      }));
      return fits();
    };

    const makeCard = (candidate, pool, info, seed, labels, smallCreatorLabel) => {
      const base = candidate.lockup ?? yt.buildLockup(pool.template, candidate, context.hl);
      const titled = info?.title ? yt.setLockupTitle(base, info.title) : base;
      const labelled = smallCreatorLabel ? yt.addSmallCreatorLabel(titled, smallCreatorLabel) : titled;
      return {
        lockup: yt.addMenuEntries(labelled, labels),
        videoId: candidate.id,
        title: info?.title ?? candidate.title,
        channelId: candidate.channelId,
        channelName: candidate.channelName,
        seed,
      };
    };

    const tagsFor = async seed => {
      if (pools.has(seed.id)) return (await pools.get(seed.id)).tags;
      return api.tags(seed.id).catch(() => []);
    };

    const findCard = async (seed, settings, labels, smallCreatorLabel) => {
      try {
        const blocks = await store.getBlocks();
        if (!seedAllowed(seed, blocks)) return null;
        const pool = await poolFor(seed, settings);
        const filterContext = {
          seed,
          settings,
          shownIds: await store.getShown(),
          hiddenChannels: new Set(blocks.channels.map(c => c.id)),
          mutedPhrases: mutedTerms(blocks),
        };
        const usable = pool.candidates
          .filter(c => !tried.has(c.id) && !pool.usedChannels.has(c.channelId))
          .filter(c => c.lockup || pool.template)
          .filter(c => topic.passesCheapFilters(c, filterContext));
        const fits = await withSubscribers(topic.lookupOrder(usable, pool.terms), settings);
        const fresh = fits.filter(c => !tried.has(c.id));
        const ordered = topic.chooseOrder(topic.rank(fresh, pool.terms), rng);

        let checks = 0;
        for (const candidate of ordered) {
          if (tried.has(candidate.id) || pool.usedChannels.has(candidate.channelId)) continue;
          if (checks >= MAX_LANGUAGE_CHECKS_PER_CARD) break;
          checks++;
          tried.add(candidate.id);
          let info;
          try {
            info = await api.watchInfo(candidate.id);
          } catch (err) {
            if (isSkip(err)) continue;
            throw err;
          }
          // The title on the card comes from this page and can differ from the one filtered above.
          if (info?.title && (hasMutedTerm(info.title, blocks) || topic.isBlankTitle(info.title))) continue;
          if (language.decide(info, settings) !== 'keep') continue;
          pool.usedChannels.add(candidate.channelId);
          await store.addShown(candidate.id);
          return makeCard(candidate, pool, info, seed, labels, settings.showSmallCreatorLabel ? smallCreatorLabel : null);
        }
        return null;
      } catch {
        return null; // paused or out of budget, so the feed simply stays as it is
      }
    };

    return { findCard, tagsFor };
  };

  // "Less of this topic": mute one clear phrase, or stop using the seed's channel if there isn't one.
  const handleLessTopic = async ({ seed, tags }, store) => {
    const phrase = topic.bestPhrase(seed.title, tags);
    if (phrase) await store.muteTopic(phrase);
    else if (seed.channelName) await store.muteSeedChannel(seed.channelName);
  };

  (globalThis.SmallYT ??= {}).pipeline = { createPipeline, handleLessTopic, seedAllowed };
})();
