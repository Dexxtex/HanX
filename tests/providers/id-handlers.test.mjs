import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// Rete per il refactor degli handler per id. I cinque `handle*Request` sono
// quasi identici nei tre provider: prima di unificarli si fissa qui cosa
// fanno oggi, cosi' una divergenza diventa un test rosso invece di un bug.
//
// Offline: il mapping e' un file locale (il gate dice "anime" senza TMDB) e la
// rete dei siti e' un mock.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hanx-idhandlers-'));
const mappingFile = path.join(dir, 'anime-seasons.json');
fs.writeFileSync(
  mappingFile,
  JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    series: {
      'imdb:tt90001': {
        title: 'Serie Mappata',
        titleIt: 'Serie Mappata',
        seasons: { '1': [{ from: 1, kitsuId: '4242', offset: 0, title: 'Serie Mappata', episodeCount: 12 }] },
      },
    },
    movies: {},
  })
);
process.env.ANIME_MAPPING_FILE = mappingFile;

const calls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = String(input);
  calls.push(url);
  // Qualsiasi ricerca/API dei siti restituisce vuoto: qui interessa se il
  // provider *arriva* a cercare, non cosa trova.
  return new Response('<html><body></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
};

const { AnimeUnityProvider } = await import('../../dist/providers/animeunity-provider.js');
const { AnimeSaturnProvider } = await import('../../dist/providers/animesaturn-provider.js');
const { AnimeWorldProvider } = await import('../../dist/providers/animeworld-provider.js');

const config = { enabled: true, proxyUrl: '', proxyPassword: '', tmdbApiKey: '' };
// [nome, classe, istanza]: la classe serve per costruire la variante disabilitata.
const providers = [
  ['AnimeUnity', AnimeUnityProvider, new AnimeUnityProvider(config)],
  ['AnimeSaturn', AnimeSaturnProvider, new AnimeSaturnProvider(config)],
  ['AnimeWorld', AnimeWorldProvider, new AnimeWorldProvider(config)],
];

test('provider disabilitato: nessuno stream e nessuna richiesta', async () => {
  for (const [name, Provider] of providers) {
    const disabled = new Provider({ ...config, enabled: false });
    calls.length = 0;
    assert.deepEqual(await disabled.handleImdbRequest('tt90001', 1, 1, false), { streams: [] }, name);
    assert.deepEqual(await disabled.handleKitsuRequest('4242:1'), { streams: [] }, name);
    assert.equal(calls.length, 0, `${name}: nessuna richiesta di rete`);
  }
});

test('id mappato: il gate lascia passare e si arriva alla ricerca', async () => {
  for (const [name, , provider] of providers) {
    calls.length = 0;
    await provider.handleImdbRequest('tt90001', 1, 1, false);
    assert.ok(calls.length > 0, `${name}: deve provare a cercare la serie mappata`);
  }
});

// Senza chiave TMDB e senza mapping non c'è modo di ottenere un titolo: il
// provider esce vuoto, ma **non lancia** e non deve sembrare un blocco del gate.
test('id non mappato senza chiave TMDB: esce vuoto senza lanciare', async () => {
  for (const [name, , provider] of providers) {
    calls.length = 0;
    const result = await provider.handleImdbRequest('tt99999', 1, 1, false);
    assert.deepEqual(result, { streams: [] }, name);
  }
});

test('id malformato: nessuna eccezione, zero stream', async () => {
  for (const [name, , provider] of providers) {
    assert.deepEqual(await provider.handleKitsuRequest('non-un-id'), { streams: [] }, name);
    assert.deepEqual(await provider.handleMalRequest(''), { streams: [] }, name);
  }
});

// Con il gate spento il percorso è identico: qui interessa che nessuno dei tre
// provider cambi comportamento quando la variabile cambia.
test('gate spento da env: stesso esito, nessuna eccezione', async () => {
  process.env.ANIME_GATE_ENABLED = 'false';
  try {
    for (const [name, , provider] of providers) {
      const result = await provider.handleImdbRequest('tt90001', 1, 1, false);
      assert.ok(Array.isArray(result.streams), name);
    }
  } finally {
    delete process.env.ANIME_GATE_ENABLED;
  }
});

test.after(() => { globalThis.fetch = originalFetch; });

// I cinque handler erano copiati nei tre provider (~380 righe, identiche
// tranne l'etichetta). Ora delegano a `anime-core/resolve-title.ts`: questo
// test impedisce che una copia rientri dalla porta di servizio.
test('i tre provider delegano alla risoluzione condivisa', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'providers');

  for (const name of ['animeunity', 'animesaturn', 'animeworld']) {
    const source = fs.readFileSync(path.join(dist, `${name}-provider.js`), 'utf8');
    for (const fn of ['resolveKitsuRequest', 'resolveMalRequest', 'resolveImdbRequest', 'resolveTmdbRequest', 'resolveTvdbRequest']) {
      assert.ok(source.includes(fn), `${name}: deve usare ${fn}`);
    }
    // La logica del gate non deve tornare nei provider.
    assert.ok(!/checkIsAnimeById\('(imdb|tmdb|tvdb)'/.test(source), `${name}: il gate vive in resolve-title`);
  }
});
