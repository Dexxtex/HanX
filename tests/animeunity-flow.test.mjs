import assert from 'node:assert/strict';
import { test } from 'node:test';

// Fixture del flusso AnimeUnity.co: ricerca server-rendered (/archivio?title=),
// episodi nell'attributo `episodes` della pagina anime, embed per episodio.
// La rete live è rate-limited, quindi mockiamo fetch e verifichiamo tutta la catena.

function attr(value) {
  return JSON.stringify(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

function record({ id, slug, title, dub, type = 'TV' }) {
  return { id, slug, title, title_it: null, title_eng: null, episodes_count: 37, dub, type };
}

const RECORDS_HTML = `<html><body><div id="archivio"
  records="${attr([record({ id: 989, slug: 'death-note', title: 'Death Note', dub: 0 }), record({ id: 990, slug: 'death-note-ita', title: 'Death Note (ITA)', dub: 1 })])}"
  all_genres="[]"></div></body></html>`;

function animeHtml({ id, slug, dub, episodeId }) {
  return `<html><body><main
    anime="${attr({ id, title: 'Death Note', dub })}"
    episodes="${attr([{ id: episodeId, number: '1' }])}"></main></body></html>`;
}

function episodeHtml(embedUrl) {
  return `<html><body><video-player embed_url="${embedUrl.replace(/&/g, '&amp;')}"></video-player></body></html>`;
}

function embedHtml(id) {
  return `<html><body><script>
    var player = new Playerjs({ url: "https://vixcloud.cc/playlist/${id}", 'token': 'tok-${id}', 'expires': '1700000000' });
  </script></body></html>`;
}

const requested = [];
globalThis.fetch = async (input) => {
  const url = String(input);
  requested.push(url);
  if (url.includes('/archivio?title=')) {
    return new Response(RECORDS_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (url.endsWith('/anime/989-death-note')) {
    return new Response(animeHtml({ id: 989, slug: 'death-note', dub: 0, episodeId: 24959 }), { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (url.endsWith('/anime/990-death-note-ita')) {
    return new Response(animeHtml({ id: 990, slug: 'death-note-ita', dub: 1, episodeId: 24960 }), { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (url.endsWith('/anime/989-death-note/24959')) {
    return new Response(episodeHtml('https://vixcloud.cc/embed/sub?token=embed-sub&expires=1700000000'), { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (url.endsWith('/anime/990-death-note-ita/24960')) {
    return new Response(episodeHtml('https://vixcloud.cc/embed/dub?token=embed-dub&expires=1700000000'), { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (url.includes('/embed/sub')) {
    return new Response(embedHtml('sub'), { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (url.includes('/embed/dub')) {
    return new Response(embedHtml('dub'), { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (url.includes('vixcloud.cc/playlist/')) {
    return new Response('#EXTM3U\n#EXTINF:6,\nsegment.ts', { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
  }
  return new Response('not found', { status: 404 });
};

const { AnimeUnityProvider, normalizeTitleForSearch } = await import('../dist/providers/animeunity-provider.js');

test('la query di ricerca non contiene spazi doppi (Season rimosso)', () => {
  // Misurato il 25/10/2026: "Black Clover  2" -> 0 record, "Black Clover 2" -> 2.
  assert.equal(normalizeTitleForSearch('Black Clover Season 2'), 'Black Clover 2');
  assert.equal(normalizeTitleForSearch('Black Clover'), 'Black Clover');
});

test('handleTitleRequest risolve SUB e ITA dalle schede separate di .co', async () => {
  const provider = new AnimeUnityProvider({ enabled: true, proxyUrl: '', proxyPassword: '', tmdbApiKey: '' });
  const { streams } = await provider.handleTitleRequest('Death Note', 1, 1, false);

  assert.deepEqual(streams.map((s) => s.title), [
    'Death Note ▪ SUB ▪ S1E1 (HLS)',
    'Death Note ▪ ITA ▪ S1E1 (HLS)',
  ]);
  assert.deepEqual(streams.map((s) => s.url), [
    'https://vixcloud.cc/playlist/sub.m3u8?token=tok-sub&expires=1700000000',
    'https://vixcloud.cc/playlist/dub.m3u8?token=tok-dub&expires=1700000000',
  ]);

  assert.ok(requested.some((u) => u.includes('/archivio?title=')));
  assert.ok(requested.some((u) => u.endsWith('/anime/989-death-note')));
  assert.ok(requested.some((u) => u.endsWith('/anime/989-death-note/24959')));
  assert.ok(requested.some((u) => u.endsWith('/anime/990-death-note-ita/24960')));
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
    assert.match(url.searchParams.get('d'), /^https:\/\/vixcloud\.cc\/playlist\/(sub|dub)\.m3u8/);
    assert.match(url.searchParams.get('h_Referer'), /^https:\/\/animeunity\.co\/anime\/9\d\d-death-note(?:-ita)?\/\d+$/);
    assert.equal(url.searchParams.get('max_res'), 'true');
  }
});
