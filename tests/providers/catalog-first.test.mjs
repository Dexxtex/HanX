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
  const body = responses.get(url.split('?')[0]);
  if (body === undefined) return new Response('not found', { status: 404, statusText: 'Not Found' });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
};

const NOW = new Date().toISOString();
const OLD = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
const CATALOG = {
  slug: 'tutor-hitman-reborn',
  url: 'https://www.animesaturn.net/anime/tutor-hitman-reborn-tuTL8',
  title: 'Tutor Hitman Reborn',
  key: 'tutorhitmanreborn',
};

function useCatalog(generatedAt) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hanx-provider-catalog-'));
  fs.writeFileSync(
    path.join(dir, 'catalog-titles.json'),
    JSON.stringify({ generatedAt, sites: { saturn: [CATALOG], world: [], unity: [] }, truncated: {} })
  );
  process.env.CATALOG_DIR = dir;
}

process.env.ANIMESATURN_BASE_URL = 'https://www.as.test';

const { AnimeSaturnProvider } = await import('../../dist/providers/animesaturn-provider.js');
const provider = new AnimeSaturnProvider({ enabled: true, proxyUrl: '', proxyPassword: '', tmdbApiKey: '' });

function saturnPage() {
  // La URL del catalogo è quella vera, token finale compreso: l'estrazione la riduce a path.
  responses.set('https://www.as.test/anime/tutor-hitman-reborn-tuTL8', `
    <html><body><h1>Tutor Hitman Reborn</h1>
    <a href="/episode/tutor-hitman-reborn-tuTL8/ep-1">Tutor Hitman Reborn Episodio 1</a>
    </body></html>`);
  responses.set('https://www.as.test/anime/tutor-hitman-reborn-tuTL8/ep-1', `
    <html><body><a href="/watch?file=abc123">Guarda</a></body></html>`);
  responses.set('https://www.as.test/watch', `
    <html><body><source src="https://cdn.example/reborn-1.mp4"></body></html>`);
}

test('catalogo fresco: la scheda si apre senza passare dalla ricerca del sito', async () => {
  useCatalog(NOW);
  saturnPage();
  calls.length = 0;
  const { streams } = await provider.handleTitleRequest('Tutor Hitman Reborn', 1, 1, false);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.example/reborn-1.mp4');
  assert.deepEqual(calls.filter((url) => /\/api\/search|\/filter\?key/.test(url)), []);
});

test('titolo assente da un catalogo fresco: nessuna richiesta di rete', async () => {
  useCatalog(NOW);
  calls.length = 0;
  const { streams } = await provider.handleTitleRequest('Titolo Che Non Esiste', 1, 1, false);
  assert.deepEqual(streams, []);
  assert.deepEqual(calls, []);
});

test('catalogo vecchio: si torna alla ricerca di rete', async () => {
  useCatalog(OLD);
  calls.length = 0;
  const { streams } = await provider.handleTitleRequest('Titolo Che Non Esiste', 1, 1, false);
  assert.deepEqual(streams, []);
  assert.ok(calls.some((url) => /\/api\/search|\/filter\?key/.test(url)), `ricerca attesa, chiamate: ${calls.join(', ')}`);
});

process.on('exit', () => {
  globalThis.fetch = originalFetch;
});
