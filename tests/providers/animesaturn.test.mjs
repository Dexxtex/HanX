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
