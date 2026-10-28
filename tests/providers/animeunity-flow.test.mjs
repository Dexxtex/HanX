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

function record({ id, slug, title, dub, type = 'TV', nameIt = null, nameEng = null, episodes = 37 }) {
  return { id, slug, title, title_it: nameIt, title_eng: nameEng, episodes_count: episodes, dub, type };
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

// Scheda italiana: nome e titolo inglese della scheda sono in italiano, quindi
// l'inglese di Kitsu non la tocca. Serve il titleIt del mapping.
const HARUHI_RECORDS_HTML = `<html><body><div id="archivio"
  records="${attr([record({
    id: 496,
    slug: 'the-melancholy-of-haruhi-suzumiya-2009',
    title: 'The Melancholy of Haruhi Suzumiya (2009)',
    nameIt: 'Suzumiya Haruhi no Yuuutsu (2009)',
    nameEng: 'La malinconia di Haruhi Suzumiya 2',
    dub: 0,
    episodes: 14,
  })])}"
  all_genres="[]"></div></body></html>`;

const EMPTY_RECORDS_HTML = '<html><body><div id="archivio" records="[]" all_genres="[]"></div></body></html>';

// Scheda con sottotitolo: il sito la chiama col sottotitolo, non "Tokyo Revengers 4".
const TOKYO_RECORDS_HTML = `<html><body><div id="archivio"
  records="${attr([record({
    id: 7773,
    slug: 'tokyo-revengers-war-of-the-three-titans-arc',
    title: 'Tokyo Revengers: Santen Sensou-hen',
    nameEng: 'Tokyo Revengers: War of the Three Titans Arc',
    dub: 0,
    episodes: 12,
  })])}"
  all_genres="[]"></div></body></html>`;

const requested = [];
let haruhiMode = false;
let tokyoMode = false;
globalThis.fetch = async (input) => {
  const url = String(input);
  requested.push(url);
  const archiveTitle = url.includes('/archivio?title=') ? new URL(url).searchParams.get('title') : null;
  if (tokyoMode) {
    if (archiveTitle !== null) {
      return new Response(archiveTitle === 'Tokyo Revengers' ? TOKYO_RECORDS_HTML : EMPTY_RECORDS_HTML, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (url.endsWith('/anime/7773-tokyo-revengers-war-of-the-three-titans-arc')) {
      return new Response(`<html><body><main anime="${attr({ id: 7773, title: 'Tokyo Revengers: Santen Sensou-hen', dub: 0 })}"
        episodes="${attr([{ id: 90136, number: '1' }, { id: 90137, number: '4' }])}"></main></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.endsWith('/anime/7773-tokyo-revengers-war-of-the-three-titans-arc/90137')) {
      return new Response(episodeHtml('https://vixcloud.cc/embed/tokyo?token=embed-tokyo&expires=1700000000'), { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('/embed/tokyo')) {
      return new Response(embedHtml('tokyo'), { status: 200, headers: { 'content-type': 'text/html' } });
    }
  }
  if (haruhiMode) {
    if (url.includes('/archivio?title=')) {
      const italian = encodeURIComponent('La malinconia di Haruhi Suzumiya 2');
      return new Response(url.includes(italian) ? HARUHI_RECORDS_HTML : EMPTY_RECORDS_HTML, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (url.endsWith('/anime/496-the-melancholy-of-haruhi-suzumiya-2009')) {
      return new Response(`<html><body><main anime="${attr({ id: 496, title: 'The Melancholy of Haruhi Suzumiya (2009)', dub: 0 })}"
        episodes="${attr([{ id: 17942, number: '4' }])}"></main></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.endsWith('/anime/496-the-melancholy-of-haruhi-suzumiya-2009/17942')) {
      return new Response(episodeHtml('https://vixcloud.cc/embed/haruhi?token=embed-haruhi&expires=1700000000'), { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('/embed/haruhi')) {
      return new Response(embedHtml('haruhi'), { status: 200, headers: { 'content-type': 'text/html' } });
    }
  }
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

const { AnimeUnityProvider, normalizeTitleForSearch, unityBaseFrom } = await import('../../dist/providers/animeunity-provider.js');

test('la base di AnimeUnity usa www: l\'apex di .co risponde 403/404', () => {
  assert.equal(unityBaseFrom('animeunity.co'), 'https://www.animeunity.co');
  assert.equal(unityBaseFrom('https://animeunity.co/'), 'https://www.animeunity.co');
  assert.equal(unityBaseFrom('https://www.animeunity.co'), 'https://www.animeunity.co');
  // Altri host restano come configurati.
  assert.equal(unityBaseFrom('animeunity.at'), 'https://animeunity.at');
  assert.equal(unityBaseFrom(''), 'https://animeunity.at');
});

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

test('handleTitleRequest ripiega sul titolo italiano quando l inglese non trova nulla', async () => {
  haruhiMode = true;
  try {
    const provider = new AnimeUnityProvider({ enabled: true, proxyUrl: '', proxyPassword: '', tmdbApiKey: '' });
    const { streams } = await provider.handleTitleRequest(
      'The Melancholy of Haruhi Suzumiya Season 2',
      2,
      4,
      false,
      null,
      'La malinconia di Haruhi Suzumiya'
    );

    // Solo la scheda (2009), non la stagione 1 che il filtro deve scartare.
    assert.equal(streams.length, 1);
    // L'etichetta porta la stagione: la scheda del sito dice "(2009)", la query
    // mappata dice "2", e per l'utente conta il secondo.
    assert.match(streams[0].title, /La malinconia di Haruhi Suzumiya 2 .* S2E4/);
    assert.ok(
      requested.some((u) => u.includes(encodeURIComponent('La malinconia di Haruhi Suzumiya 2'))),
      'la ricerca di ripiego deve usare il titolo italiano con la stagione'
    );
  } finally {
    haruhiMode = false;
  }
});

test('con sottotitolo nel titolo il ripiego resta il titolo base, non l italiano', async () => {
  tokyoMode = true;
  try {
    const provider = new AnimeUnityProvider({ enabled: true, proxyUrl: '', proxyPassword: '', tmdbApiKey: '' });
    const { streams } = await provider.handleTitleRequest(
      'Tokyo Revengers: The Three Deities',
      4,
      4,
      false,
      null,
      'Tokyo Revengers'
    );

    assert.equal(streams.length, 1);
    const archiveQueries = requested
      .filter((u) => u.includes('/archivio?title='))
      .map((u) => new URL(u).searchParams.get('title'));
    assert.ok(archiveQueries.includes('Tokyo Revengers'), 'il ripiego deve cercare il titolo base');
    assert.equal(archiveQueries.includes('Tokyo Revengers 4'), false, 'la query italiana composta è sbagliata qui');
  } finally {
    tokyoMode = false;
  }
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
    // Al proxy va l'embed, non la playlist: il token lo genera il proxy dal suo IP.
    assert.match(url.searchParams.get('d'), /^https:\/\/vixsrc\.to\/embed\/(sub|dub)/);
    assert.equal(url.searchParams.get('h_Origin'), 'https://vixsrc.to');
    assert.match(url.searchParams.get('h_Referer'), /^https:\/\/www\.animeunity\.co\/anime\/9\d\d-death-note(?:-ita)?\/\d+$/);
    assert.equal(url.searchParams.get('max_res'), 'true');
  }
});
