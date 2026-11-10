import assert from 'node:assert/strict';
import { test } from 'node:test';

// fetchResource cattura globalThis.fetch all'import: il mock va installato prima.
const responses = new Map();
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input.url;
  const key = url.split('?')[0];
  const body = responses.get(key);
  if (body === undefined) return new Response('not found', { status: 404, statusText: 'Not Found' });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
};

process.env.ANIMESATURN_BASE_URL = 'https://www.as.test';

const { AnimeSaturnProvider } = await import('../../dist/providers/animesaturn-provider.js');
const provider = new AnimeSaturnProvider({
  enabled: true,
  proxyUrl: '',
  proxyPassword: '',
  tmdbApiKey: '',
});

test('AnimeSaturn: embed irrisolto non salta i link diretti della stessa watch page', async () => {
  responses.set('https://www.as.test/anime/test-anime', `
    <html><body><h1>Test Anime</h1>
    <a href="/episode/test-anime/ep-1">Test Anime Episodio 1</a>
    </body></html>`);
  responses.set('https://www.as.test/anime/test-anime/ep-1', `
    <html><body><a href="/watch?file=abc123">Guarda</a></body></html>`);
  responses.set('https://www.as.test/watch', `
    <html><body>
      <iframe src="https://play.saturncdn.net/embed/999"></iframe>
      <source src="https://cdn.example/video.mp4">
    </body></html>`);

  const streams = await provider.extractStreamsFromAnimePath('/anime/test-anime', 1, 2, 'tv');
  assert.equal(streams.length, 1, 'la watch page espone un solo media diretto');
  assert.equal(streams[0].url, 'https://cdn.example/video.mp4');
  assert.ok(streams[0].title.startsWith('Test Anime ▪ SUB ▪ S2E1'), streams[0].title);
});

test('AnimeSaturn: E1 non ripiega sul primo episodio della lista se manca l\'E1', async () => {
  responses.set('https://www.as.test/anime/no-first', `
    <html><body><h1>No First</h1>
    <a href="/episode/no-first/ep-2">No First Episodio 2</a>
    </body></html>`);

  const streams = await provider.extractStreamsFromAnimePath('/anime/no-first', 1, null, 'tv');
  assert.deepEqual(streams, []);
});

process.on('exit', () => {
  globalThis.fetch = originalFetch;
});

const { filterAnimeResults } = await import('../../dist/providers/animesaturn-provider.js');

test('un solo risultato del sito vale anche senza match di titolo (scheda in italiano)', () => {
  // Caso reale: il film e' "La scomparsa di Haruhi Suzumiya", le query sono
  // inglese e romaji. Score 0, ma il match l'ha fatto la ricerca del sito.
  const results = [
    { version: { title: 'La scomparsa di Haruhi Suzumiya', url: 'https://as/anime/la-scomparsa' }, language_type: 'SUB ITA' },
  ];
  const out = filterAnimeResults(results, ['The Disappearance of Haruhi Suzumiya', 'Suzumiya Haruhi no Shoushitsu']);
  assert.deepEqual(out.map(r => r.version.title), ['La scomparsa di Haruhi Suzumiya']);
});

test('con due risultati non pertinenti non si accetta nulla', () => {
  const results = [
    { version: { title: 'Altro anime', url: 'u1' }, language_type: 'SUB ITA' },
    { version: { title: 'Un altro ancora', url: 'u2' }, language_type: 'SUB ITA' },
  ];
  assert.equal(filterAnimeResults(results, ['The Disappearance of Haruhi Suzumiya']).length, 0);
});

test('una query di una parola non basta per accettare un estraneo', () => {
  const results = [{ version: { title: 'Qualcosa di completamente diverso', url: 'u' }, language_type: 'SUB ITA' }];
  assert.equal(filterAnimeResults(results, ['Naruto']).length, 0);
});

test('il match esatto continua a vincere', () => {
  const results = [
    { version: { title: 'La malinconia di Haruhi Suzumiya 2', url: 'u1' }, language_type: 'SUB ITA' },
    { version: { title: 'Altro', url: 'u2' }, language_type: 'SUB ITA' },
  ];
  const out = filterAnimeResults(results, ['La malinconia di Haruhi Suzumiya 2']);
  assert.deepEqual(out.map(r => r.version.url), ['u1']);
});

const { decodeHtmlEntities } = await import('../../dist/providers/animesaturn-provider.js');

test('le entità numeriche con lo zero davanti vengono decodificate', () => {
  // Visto in produzione: il titolo arrivava come "The World&#039;s Strongest Witch",
  // perché il sito scrive &#039; e il decoder elencava solo &#39;.
  assert.equal(decodeHtmlEntities('The World&#039;s Strongest Witch'), "The World's Strongest Witch");
  assert.equal(decodeHtmlEntities('&#8217;'), '\u2019');
  assert.equal(decodeHtmlEntities('&#x27;'), "'");
  assert.equal(decodeHtmlEntities('&quot;A&quot; &amp; B &lt;c&gt;&nbsp;d'), '"A" & B <c> d');
  // Doppia codifica: si decodifica una volta sola, non fino a esaurimento.
  assert.equal(decodeHtmlEntities('&amp;#039;'), '&#039;');
});

const { parseAnimeSaturnPage } = await import('../../dist/providers/animesaturn-provider.js');

// Nella pagina di una scheda ci sono anchor `/episode/` di altre opere
// (sidebar, correlati). Senza il confronto dello slug ognuno diventava
// l'episodio N di questa scheda e `pickEpisodeEntry` lo serviva al posto di
// quello giusto.
test('un anchor /episode/ di un altra opera non diventa un episodio di questa', () => {
  const html = [
    '<a href="/episode/test-anime/ep-1">Episodio 1</a>',
    '<a href="/episode/test-anime/ep-2">Episodio 2</a>',
    '<a href="/episode/altra-opera/ep-9">Altro</a>',
  ].join('\n');

  const page = parseAnimeSaturnPage(html, { animePath: '/anime/test-anime' });

  assert.deepEqual(page.episodes.map((entry) => entry.num), [1, 2]);
  assert.deepEqual(
    page.episodes.map((entry) => entry.episodePath),
    ['/episode/test-anime/ep-1', '/episode/test-anime/ep-2']
  );
});

test('se nessuno slug combacia si tiene tutto: il filtro non svuota la lista', () => {
  const html = '<a href="/episode/slug-diverso/ep-1">Episodio 1</a>';

  const page = parseAnimeSaturnPage(html, { animePath: '/anime/test-anime' });

  assert.equal(page.episodes.length, 1, 'meglio gli episodi di prima che zero');
});

// La variante senza numerale di parte deve poter matchare: MAL distingue le
// parti di una trilogia col numerale, la scheda del sito non ce l'ha.
// Ma "Jujutsu Kaisen" per il film "Jujutsu Kaisen: Execution" resta un
// troncamento da scartare: il token in più è un sottotitolo, non un numerale.
test('il numerale di parte non rende la variante un troncamento', () => {
  const movie = (title) => ({ version: { title, url: '/anime/x', language_type: 'SUB ITA' }, language_type: 'SUB ITA' });
  const titles = ['Demon Slayer: Kimetsu no Yaiba Infinity Castle I', 'Demon Slayer: Kimetsu no Yaiba Infinity Castle'];
  const kept = filterAnimeResults([movie('Demon Slayer: Kimetsu no Yaiba Infinity Castle')], titles, false, true);
  assert.equal(kept.length, 1, 'la scheda senza numerale deve passare');

  const series = ['Jujutsu Kaisen: Execution', 'Jujutsu Kaisen'];
  const dropped = filterAnimeResults([movie('Jujutsu Kaisen')], series, false, true);
  assert.equal(dropped.length, 0, "l'opera madre non deve rispondere al posto del film");
});

// La guardia sul troncamento valeva solo per i ripieghi: il primo filtro di un
// film la saltava. Per un film il sottotitolo è parte dell'identità, quindi un
// titolo italiano che è un troncamento dell'originale non deve far accettare
// l'opera madre. Misurato sul mapping: 65 film su 1.202 hanno `titleIt` che è
// un troncamento di `title` ("Clannad" da "Clannad The Motion Picture").
test("film: il titolo italiano troncato non fa accettare l'opera madre", () => {
  const entry = (title) => ({ version: { title, url: '/anime/x', language_type: 'SUB ITA' }, language_type: 'SUB ITA' });
  const titles = ['Clannad The Motion Picture', 'Clannad'];

  assert.equal(
    filterAnimeResults([entry('Clannad')], titles, true, true).length,
    0,
    'film: la scheda della serie non deve rispondere per il film'
  );
  assert.equal(
    filterAnimeResults([entry('Clannad')], titles, true, false).length,
    1,
    'serie: il comportamento resta quello di prima'
  );
  assert.equal(
    filterAnimeResults([entry('Clannad The Motion Picture')], titles, true, true).length,
    1,
    'film: il match esatto passa'
  );
});
