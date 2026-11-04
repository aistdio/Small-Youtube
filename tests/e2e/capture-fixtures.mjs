// Saves trimmed, logged-out YouTube responses to tests/fixtures for the unit tests.
// Re-run this when YouTube changes its response shapes: `npm run fixtures`.
import fs from 'node:fs';
import path from 'node:path';
import { launch, ROOT } from './harness.mjs';

const OUT = path.join(ROOT, 'tests', 'fixtures');
fs.mkdirSync(OUT, { recursive: true });

const MAX_ITEMS = 8;
const DROP = new Set([
  'trackingParams', 'clickTrackingParams', 'serviceTrackingParams', 'webResponseContextExtensionData',
  'frameworkUpdates', 'topbar', 'engagementPanels', 'playerOverlays', 'overlay', 'loggingDirectives',
  'url_encoded_fmt_stream_map', 'signatureCipher', 'playerConfig', 'storyboards', 'attestation',
  'annotations', 'adPlacements', 'playerAds', 'cards', 'heartbeatParams', 'adSlots', 'microformat',
]);

// Removes tracking data and signed stream links, and keeps only the first few videos in each list.
function trim(value) {
  if (Array.isArray(value)) {
    let kept = 0;
    const isVideo = x => x && typeof x === 'object' && (x.videoRenderer || x.lockupViewModel);
    return value.filter(x => !isVideo(x) || kept++ < MAX_ITEMS).map(trim);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!DROP.has(k)) out[k] = trim(v);
    return out;
  }
  return value;
}

function trimPlayer(p) {
  const audio = (p.streamingData?.adaptiveFormats || [])
    .filter(f => (f.mimeType || '').startsWith('audio') && f.audioTrack)
    .map(f => ({ mimeType: f.mimeType, audioTrack: f.audioTrack }));
  const seen = new Set();
  const formats = audio.filter(f => !seen.has(f.audioTrack.id) && seen.add(f.audioTrack.id));
  const cap = p.captions?.playerCaptionsTracklistRenderer;
  return {
    videoDetails: { videoId: p.videoDetails?.videoId, title: p.videoDetails?.title, author: p.videoDetails?.author, channelId: p.videoDetails?.channelId },
    streamingData: { adaptiveFormats: formats },
    captions: cap ? { playerCaptionsTracklistRenderer: { captionTracks: (cap.captionTracks || []).map(c => ({ languageCode: c.languageCode, kind: c.kind })) } } : undefined,
  };
}

const save = (name, text) => fs.writeFileSync(path.join(OUT, name), text);
const saveJson = (name, obj) => save(name, JSON.stringify(obj));

const inPage = {
  api: (page, ep, body, hl, gl) => page.evaluate(async ({ ep, body, hl, gl }) => {
    const r = await fetch(`/youtubei/v1/${ep}?prettyPrint=false`, {
      method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: ytcfg.get('INNERTUBE_CLIENT_VERSION'), hl, gl } }, ...body }),
    });
    return r.json();
  }, { ep, body, hl, gl }),
  html: (page, url) => page.evaluate(async url => (await fetch(url, { credentials: 'include' })).text(), url),
};

const pick = (html, name) => {
  const m = html.match(new RegExp(`var ${name}\\s*=\\s*(\\{[\\s\\S]*?\\});\\s*(?:var |</script>)`));
  if (!m) throw new Error(`${name} not found`);
  return JSON.parse(m[1]);
};
const dataPage = (name, html, fn = trim) => `<script>var ${name} = ${JSON.stringify(fn(pick(html, name)))};</script>`;

const open = async locale => {
  const b = await launch({ locale, extension: false });
  await b.page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await b.page.waitForFunction(() => window.ytcfg?.get?.('INNERTUBE_CLIENT_VERSION'), null, { timeout: 30000 });
  return b;
};

// Only the parts that show whether a video carries YouTube's "AI" label, from the normal page.
const collect = (o, key, acc = []) => {
  if (!o || typeof o !== 'object') return acc;
  if (o[key]) acc.push(o[key]);
  for (const k in o) collect(o[k], key, acc);
  return acc;
};
const aiPage = html => {
  const data = pick(html, 'ytInitialData');
  const madeWith = collect(data, 'howThisWasMadeSectionViewModel').map(s => ({ howThisWasMadeSectionViewModel: { sectionTitle: s.sectionTitle, bodyHeader: s.bodyHeader } }));
  const primary = collect(data, 'videoPrimaryInfoRenderer').map(r => ({ videoPrimaryInfoRenderer: { badges: trim(r.badges ?? []) } }));
  return `${dataPage('ytInitialPlayerResponse', html, trimPlayer)}<script>var ytInitialData = ${JSON.stringify({ madeWith, primary })};</script>`;
};
const aiBrowser = await open('en-US');
save('watch.ai-made.html', aiPage(await inPage.html(aiBrowser.page, '/watch?v=HWiX_2xMYAw')));
save('watch.not-ai.html', aiPage(await inPage.html(aiBrowser.page, '/watch?v=IWbeDRbK-wk')));
await aiBrowser.close();
if (process.argv.includes('--only-ai')) process.exit(0);

const QUERY = 'Epic Seven Steam';
const VIDEO_FILTER = 'EgIQAQ==';

const en = await open('en-US');
saveJson('search.en.json', trim(await inPage.api(en.page, 'search', { query: QUERY, params: VIDEO_FILTER }, 'en', 'US')));
saveJson('next.en.json', trim(await inPage.api(en.page, 'next', { videoId: 'IWbeDRbK-wk' }, 'en', 'US')));
const related = await inPage.api(en.page, 'next', { videoId: 'IWbeDRbK-wk' }, 'en', 'US');
const channelId = (JSON.stringify(related).match(/"browseId":"(UC[\w-]{22})"/) || [])[1];
const browse = await inPage.api(en.page, 'browse', { browseId: channelId, params: 'EgZ2aWRlb3PyBgQKAjoA' }, 'en', 'US');
saveJson('browse.en.json', trim({ header: browse.header }));
const player = await inPage.api(en.page, 'player', { videoId: 'FTrAYTyuK4Q' }, 'en', 'US');
saveJson('player.en.json', { videoDetails: { title: player.videoDetails?.title, keywords: player.videoDetails?.keywords, channelId: player.videoDetails?.channelId }, playabilityStatus: { status: player.playabilityStatus?.status } });
save('watch.dub-default.html', dataPage('ytInitialPlayerResponse', await inPage.html(en.page, '/watch?v=FTrAYTyuK4Q'), trimPlayer));
save('watch.no-tracks.html', dataPage('ytInitialPlayerResponse', await inPage.html(en.page, '/watch?v=IWbeDRbK-wk'), trimPlayer));
save('watch.finnish.html', dataPage('ytInitialPlayerResponse', await inPage.html(en.page, '/watch?v=Tze4yg8ECxY'), trimPlayer));
save('watch.no-language.html', dataPage('ytInitialPlayerResponse', await inPage.html(en.page, '/watch?v=lTzQ8W2abbo'), trimPlayer));
await en.close();

const ru = await open('ru-RU');
saveJson('search.ru.json', trim(await inPage.api(ru.page, 'search', { query: QUERY, params: VIDEO_FILTER }, 'ru', 'RU')));
saveJson('next.ru.json', trim(await inPage.api(ru.page, 'next', { videoId: 'IWbeDRbK-wk' }, 'ru', 'RU')));
save('results.ru.html', dataPage('ytInitialData', await inPage.html(ru.page, `/results?search_query=${encodeURIComponent(QUERY)}&sp=EgIQAQ%253D%253D`)));
save('watch-related.ru.html', dataPage('ytInitialData', await inPage.html(ru.page, '/watch?v=IWbeDRbK-wk'), d => {
  const secondary = d.contents?.twoColumnWatchNextResults?.secondaryResults;
  return trim({ contents: { twoColumnWatchNextResults: { secondaryResults: secondary } } });
}));
await ru.close();

const de = await open('de-DE');
save('watch.original-default.html', dataPage('ytInitialPlayerResponse', await inPage.html(de.page, '/watch?v=FTrAYTyuK4Q'), trimPlayer));
await de.close();

for (const f of fs.readdirSync(OUT)) console.log(f, Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + ' KB');
