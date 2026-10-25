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

const { AnimeSaturnProvider } = await import('../dist/providers/animesaturn-provider.js');
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
