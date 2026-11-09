import assert from 'node:assert/strict';
import { test } from 'node:test';

const { dispatchRequest } = await import('../../dist/providers/registry.js');

// Il dispatch era scritto a mano tre volte in addon.ts. Un quarto provider
// significava toccare cinque punti, e dimenticarne uno non dava errore.
function fakeProvider(calls) {
  const record = (name) => (...args) => { calls.push([name, ...args]); return Promise.resolve({ streams: [] }); };
  return {
    handleKitsuRequest: record('kitsu'),
    handleMalRequest: record('mal'),
    handleImdbRequest: record('imdb'),
    handleTmdbRequest: record('tmdb'),
    handleTvdbRequest: record('tvdb'),
  };
}

test('dispatchRequest: ogni prefisso va al metodo giusto', async () => {
  const calls = [];
  const p = fakeProvider(calls);
  await dispatchRequest(p, 'kitsu:123:4', null, 4, false);
  await dispatchRequest(p, 'mal:42:1:2', 1, 2, false);
  await dispatchRequest(p, 'tt1234567:2:3', 2, 3, false);
  await dispatchRequest(p, 'tmdb:999:1:5', 1, 5, false);
  await dispatchRequest(p, 'tvdb:777:3:1', 3, 1, false);
  assert.deepEqual(calls.map((c) => c[0]), ['kitsu', 'mal', 'imdb', 'tmdb', 'tvdb']);
});

test('dispatchRequest: tmdb e tvdb ricevono solo la parte numerica', async () => {
  const calls = [];
  const p = fakeProvider(calls);
  await dispatchRequest(p, 'tmdb:999:1:5', 1, 5, false);
  await dispatchRequest(p, 'tvdb:777:3:1', 3, 1, false);
  // `toNumericId` torna una stringa: il test fissa il comportamento reale.
  assert.equal(calls[0][1], '999');
  assert.equal(calls[1][1], '777');
});

test('dispatchRequest: un id sconosciuto non chiama nessuno', async () => {
  const calls = [];
  const result = await dispatchRequest(fakeProvider(calls), 'pippo:1', null, null, false);
  assert.deepEqual(result.streams, []);
  assert.equal(calls.length, 0);
});
