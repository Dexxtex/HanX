import assert from 'node:assert/strict';
import { test } from 'node:test';

// Fixture del flusso .at: la rete live è rate-limited, quindi mockiamo fetch
// e verifichiamo l'intera catena (ricerca -> episodio -> server -> HLS).
const SEARCH_JSON = {
  status: 200,
  result: {
    html: `<div class="result"><a href="https://www.animeunity.at/anime/989-death-note" class="livesearch-item">
      <div class="livesearch-title">Death Note</div>
      <div class="livesearch-info-wrap"><span>2006</span><span>TV</span><span> • 37/37 episodi</span></div></a></div>`,
  },
};

const ANIME_HTML = `<html><head><meta property="og:title" content="Death Note - AnimeUnity"></head><body>
  <div class="episodes"><ul class="ep-range"><li class="episode episode-item" data-num="1">
    <a href="/anime/989-death-note/ep-24959" title="Episodio 1: Rebirth" data-id="24959" data-num="1" data-sub="1" data-dub="1">1</a>
  </li></ul></div></body></html>`;

const EPISODE_HTML = `<html><body><div id="w-servers">
  <ul class="servers-sub" data-type="sub">
    <li class="server-item" data-type="sub" data-ep-id="24959" data-sv-id="animesaturn" data-link-id="link-sub-as"></li>
    <li class="server-item" data-type="sub" data-ep-id="24959" data-sv-id="vixcloud" data-link-id="link-sub-vix"></li>
  </ul>
  <ul class="servers-dub" data-type="dub">
    <li class="server-item" data-type="dub" data-ep-id="24959" data-sv-id="vixcloud" data-link-id="link-dub-vix"></li>
  </ul>
</div></body></html>`;

function embedHtml(id) {
  return `<html><body><script>
    var player = new Playerjs({ url: "https://vixcloud.co/playlist/${id}", 'token': 'tok-${id}', 'expires': '1700000000' });
  </script></body></html>`;
}

const requested = [];
globalThis.fetch = async (input) => {
  const url = String(input);
  requested.push(url);
  if (url.includes('/ajax/anime/search?keyword=')) {
    return new Response(JSON.stringify(SEARCH_JSON), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.endsWith('/anime/989-death-note')) {
    return new Response(ANIME_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (url.endsWith('/anime/989-death-note/ep-24959')) {
    return new Response(EPISODE_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (url.includes('/ajax/server?get=link-sub-vix')) {
    return new Response(JSON.stringify({ status: 200, result: { url: 'https://www.animeunity.at/embed/source/sub', type: 'iframe' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.includes('/ajax/server?get=link-dub-vix')) {
    return new Response(JSON.stringify({ status: 200, result: { url: 'https://www.animeunity.at/embed/source/dub', type: 'iframe' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.endsWith('/embed/source/sub')) {
    return new Response(embedHtml('sub'), { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (url.endsWith('/embed/source/dub')) {
    return new Response(embedHtml('dub'), { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (url.includes('vixcloud.co/playlist/')) {
    return new Response('#EXTM3U\n#EXTINF:6,\nsegment.ts', { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
  }
  return new Response('not found', { status: 404 });
};

const { AnimeUnityProvider } = await import('../dist/providers/animeunity-provider.js');

test('handleTitleRequest risolve SUB e ITA dal nuovo backend .at', async () => {
  const provider = new AnimeUnityProvider({ enabled: true, proxyUrl: '', proxyPassword: '', tmdbApiKey: '' });
  const { streams } = await provider.handleTitleRequest('Death Note', 1, 1, false);

  assert.deepEqual(streams.map((s) => s.title), [
    'Death Note ▪ SUB ▪ S1E1 (HLS)',
    'Death Note ▪ ITA ▪ S1E1 (HLS)',
  ]);
  assert.deepEqual(streams.map((s) => s.url), [
    'https://vixcloud.co/playlist/sub.m3u8?token=tok-sub&expires=1700000000',
    'https://vixcloud.co/playlist/dub.m3u8?token=tok-dub&expires=1700000000',
  ]);

  assert.ok(requested.some((u) => u.includes('/ajax/anime/search?keyword=Death%20Note')));
  assert.ok(requested.some((u) => u.endsWith('/anime/989-death-note/ep-24959')));
  assert.ok(requested.some((u) => u.includes('/ajax/server?get=link-sub-vix')));
  assert.ok(requested.some((u) => u.includes('/ajax/server?get=link-dub-vix')));
});

test('handleTitleRequest costruisce URL EasyProxy per HLS quando il proxy è configurato', async () => {
  const provider = new AnimeUnityProvider({
    enabled: true,
    proxyUrl: 'http://easyproxy.local:7860',
    proxyPassword: 'p&ss',
    tmdbApiKey: '',
  });
  const { streams } = await provider.handleTitleRequest('Death Note', 1, 1, false);

  assert.equal(streams.length, 2);
  for (const stream of streams) {
    const url = new URL(stream.url);
    assert.equal(url.origin, 'http://easyproxy.local:7860');
    assert.equal(url.pathname, '/proxy/hls/manifest.m3u8');
    assert.equal(url.searchParams.get('api_password'), 'p&ss');
    assert.match(url.searchParams.get('d'), /^https:\/\/vixcloud\.co\/playlist\/(sub|dub)\.m3u8/);
    assert.equal(url.searchParams.get('h_Referer'), 'https://www.animeunity.at/anime/989-death-note/ep-24959');
    assert.equal(url.searchParams.get('max_res'), 'true');
  }
});
