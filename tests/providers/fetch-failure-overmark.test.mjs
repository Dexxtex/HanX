// AC3d: over-marking reale. Una sotto-fetch tollerata (prima watch page 404)
// fallisce mentre il provider restituisce stream validi -> failed = true e la
// lista non viene cachata. File separato: lo stub di fetch-failure-flag è
// "sempre in errore" e una fixture per URL lo renderebbe dipendente dall'ordine.
// Igiene proxy obbligatoria: con PROXY impostata la catena usa undiciFetch e il
// test uscirebbe dall'offline.
process.env.ANIME_HOST_MIN_INTERVAL_MS = '0';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const proxyEnv = ['PROXY', 'AS_PROXY', 'AW_PROXY', 'AU_PROXY'];
const savedProxy = Object.fromEntries(proxyEnv.map((key) => [key, process.env[key]]));
for (const key of proxyEnv) delete process.env[key];

const originalFetch = globalThis.fetch;
let watchHits = 0;
globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input.url;
  const { pathname } = new URL(url);
  const html = (body) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  if (pathname === '/anime/test-anime') {
    return html('<html><body><h1>Test Anime</h1><a href="/episode/test-anime/ep-1">Test Anime Episodio 1</a></body></html>');
  }
  if (pathname === '/anime/test-anime/ep-1') {
    return html('<html><body><a href="/watch?file=abc123">Guarda</a></body></html>');
  }
  if (pathname === '/watch') {
    watchHits += 1;
    // La prima watch page è la sotto-fetch tollerata (continue nel provider).
    if (watchHits === 1) return new Response('not found', { status: 404, statusText: 'Not Found' });
    return html('<html><body><source src="https://cdn.example/video.mp4"></body></html>');
  }
  return new Response('not found', { status: 404, statusText: 'Not Found' });
};

process.env.ANIMESATURN_BASE_URL = 'https://www.as.test';

const { AnimeSaturnProvider } = await import('../../dist/providers/animesaturn-provider.js');
const { providerRequestStore } = await import('../../dist/providers/anime-core/fetch-resource.js');

after(() => {
  globalThis.fetch = originalFetch;
  for (const key of proxyEnv) {
    if (savedProxy[key] === undefined) delete process.env[key];
    else process.env[key] = savedProxy[key];
  }
});

test('una watch page 404 marca lo store anche se il provider restituisce stream', async () => {
  const provider = new AnimeSaturnProvider({ enabled: true, proxyUrl: '', proxyPassword: '', tmdbApiKey: '' });
  const store = { failed: false };

  const streams = await providerRequestStore.run(
    store,
    () => provider.extractStreamsFromAnimePath('/anime/test-anime', 1, 2, 'tv')
  );

  assert.ok(streams.length >= 1, 'lo stream diretto deve esserci');
  assert.equal(streams[0].url, 'https://cdn.example/video.mp4');
  assert.equal(store.failed, true, 'la sotto-fetch fallita deve marcare');
  assert.equal(watchHits, 2, 'entrambe le watch page devono essere tentate');
});
