import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// fetchResource cattura globalThis.fetch all'import: il mock va installato prima.
const responses = new Map();
const calls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input.url;
  calls.push(url);
  // La watch page restituisce lo stream del `file` richiesto: così ogni scheda
  // ha il suo media e la fixture non dipende dall'ordine dei test.
  if (url.split('?')[0] === 'https://www.as.test/watch') {
    const file = new URL(url).searchParams.get('file');
    return new Response(`<html><body><source src="https://cdn.example/${file}.mp4"></body></html>`, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  }
  const body = responses.get(url.split('?')[0]);
  if (body === undefined) return new Response('not found', { status: 404, statusText: 'Not Found' });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
};

const NOW = new Date().toISOString();
const OLD = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

const catalogEntry = (title, slug) => ({
  slug,
  url: `https://www.animesaturn.net/anime/${slug}`,
  title,
  key: '',
});

function useCatalog(entries, generatedAt = NOW) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hanx-provider-catalog-'));
  fs.writeFileSync(
    path.join(dir, 'catalog-titles.json'),
    JSON.stringify({ generatedAt, sites: { saturn: entries, world: [], unity: [] } })
  );
  process.env.CATALOG_DIR = dir;
  return dir;
}

/** Pagina anime + episodio 1: quanto basta per uno stream (la watch page è nel mock). */
function mockAnime(slug, title) {
  responses.set(`https://www.as.test/anime/${slug}`, `
    <html><body><h1>${title}</h1>
    <a href="/episode/${slug}/ep-1">${title} Episodio 1</a>
    </body></html>`);
  responses.set(`https://www.as.test/anime/${slug}/ep-1`, `
    <html><body><a href="/watch?file=${slug}">Guarda</a></body></html>`);
}

process.env.ANIMESATURN_BASE_URL = 'https://www.as.test';

const { AnimeSaturnProvider } = await import('../../dist/providers/animesaturn-provider.js');
const provider = new AnimeSaturnProvider({ enabled: true, proxyUrl: '', proxyPassword: '', tmdbApiKey: '' });

const animeCalls = () => calls.filter((url) => /\/anime\/[^/]+$/.test(url));

test('catalogo: la scheda si apre senza passare dalla ricerca del sito', async () => {
  useCatalog([catalogEntry('Tutor Hitman Reborn', 'solo-reborn-Kk9z8')]);
  mockAnime('solo-reborn-Kk9z8', 'Tutor Hitman Reborn');
  calls.length = 0;
  const { streams } = await provider.handleTitleRequest('Tutor Hitman Reborn', 1, 1, false);
  assert.deepEqual(streams.map((stream) => stream.url), ['https://cdn.example/solo-reborn-Kk9z8.mp4']);
  assert.deepEqual(calls.filter((url) => /\/api\/search|\/filter\?key/.test(url)), []);
});

test('catalogo: tie di stagione risolto prima della rete (Dr Stone 2 vs 3 Part 2)', async () => {
  useCatalog([
    catalogEntry('Dr Stone 2', 'dr-stone-2-Ab12c'),
    catalogEntry('Dr Stone 3 Part 2', 'dr-stone-3-part-2-Zz99x'),
  ]);
  mockAnime('dr-stone-2-Ab12c', 'Dr Stone 2');
  mockAnime('dr-stone-3-part-2-Zz99x', 'Dr Stone 3 Part 2');
  calls.length = 0;
  const { streams } = await provider.handleTitleRequest('Dr Stone 2', 2, 1, false);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.example/dr-stone-2-Ab12c.mp4');
  assert.ok(animeCalls().some((url) => url.includes('dr-stone-2')));
  assert.ok(!animeCalls().some((url) => url.includes('dr-stone-3')));
});

test('catalogo: le varianti ita/sub sono due schede e si aprono entrambe', async () => {
  useCatalog([
    catalogEntry('Tutor Hitman Reborn', 'tutor-hitman-reborn-tuTL8'),
    catalogEntry('Tutor Hitman Reborn Ita', 'tutor-hitman-reborn-ita-V4SCx'),
  ]);
  mockAnime('tutor-hitman-reborn-tuTL8', 'Tutor Hitman Reborn');
  mockAnime('tutor-hitman-reborn-ita-V4SCx', 'Tutor Hitman Reborn Ita');
  calls.length = 0;
  const { streams } = await provider.handleTitleRequest('Tutor Hitman Reborn', 1, 1, false);
  assert.deepEqual(streams.map((stream) => stream.url).sort(), [
    'https://cdn.example/tutor-hitman-reborn-ita-V4SCx.mp4',
    'https://cdn.example/tutor-hitman-reborn-tuTL8.mp4',
  ]);
  assert.equal(animeCalls().filter((url) => url.includes('tutor-hitman-reborn')).length, 2);
});

test('catalogo: per un film si serve la scheda film, per una serie quella TV', async () => {
  useCatalog([
    catalogEntry('Tutor Hitman Reborn', 'reborn-tv-Qq1w2'),
    catalogEntry('Tutor Hitman Reborn Movie', 'reborn-movie-Ee3r4'),
  ]);
  mockAnime('reborn-tv-Qq1w2', 'Tutor Hitman Reborn');
  mockAnime('reborn-movie-Ee3r4', 'Tutor Hitman Reborn Movie');
  calls.length = 0;
  const film = await provider.handleTitleRequest('Tutor Hitman Reborn', null, 1, true);
  assert.deepEqual(film.streams.map((stream) => stream.url), ['https://cdn.example/reborn-movie-Ee3r4.mp4']);
  calls.length = 0;
  const serie = await provider.handleTitleRequest('Tutor Hitman Reborn', null, 1, false);
  assert.deepEqual(serie.streams.map((stream) => stream.url), ['https://cdn.example/reborn-tv-Qq1w2.mp4']);
});

test('catalogo: malId esatto apre la scheda anche se il titolo non c entra', async () => {
  useCatalog([{ ...catalogEntry('Titolo Sul Sito', 'scheda-mal-Qw3Er'), malId: 52034 }]);
  mockAnime('scheda-mal-Qw3Er', 'Titolo Sul Sito');
  calls.length = 0;
  const { streams } = await provider.handleTitleRequest('Un Titolo Diverso', 1, 1, false, undefined, undefined, undefined, 52034);
  assert.deepEqual(streams.map((stream) => stream.url), ['https://cdn.example/scheda-mal-Qw3Er.mp4']);
  assert.deepEqual(calls.filter((url) => /\/api\/search|\/filter\?key/.test(url)), []);
});

test('catalogo: ambiguo (due basi diverse) non si serve, si torna alla ricerca', async () => {
  useCatalog([catalogEntry('Tutor Hitman Reborn', 'a1'), catalogEntry('Katekyo Hitman Reborn', 'b2')]);
  calls.length = 0;
  const { streams } = await provider.handleTitleRequest('Reborn!', 1, 1, false);
  assert.deepEqual(streams, []);
  assert.ok(calls.some((url) => /\/api\/search|\/filter\?key/.test(url)), calls.join(', '));
});

test('titolo assente dal catalogo: si torna alla ricerca di rete', async () => {
  useCatalog([]);
  calls.length = 0;
  const { streams } = await provider.handleTitleRequest('Titolo Che Non Esiste', 1, 1, false);
  assert.deepEqual(streams, []);
  assert.ok(calls.some((url) => /\/api\/search|\/filter\?key/.test(url)));
});

test('catalogo vecchio: stesso comportamento, la rete resta la verità', async () => {
  useCatalog([], OLD);
  calls.length = 0;
  const { streams } = await provider.handleTitleRequest('Titolo Che Non Esiste', 1, 1, false);
  assert.deepEqual(streams, []);
  assert.ok(calls.some((url) => /\/api\/search|\/filter\?key/.test(url)));
});

process.on('exit', () => {
  globalThis.fetch = originalFetch;
});
