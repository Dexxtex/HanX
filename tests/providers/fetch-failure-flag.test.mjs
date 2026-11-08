// C2-I2: lo store AsyncLocalStorage marca il provider-run quando una fetch
// provider-site fallisce. Stub installato prima dell'import: fetch-resource
// cattura `globalThis.fetch` al load. Igiene proxy obbligatoria: con PROXY
// impostata la catena usa undiciFetch e bypasserebbe lo stub.
process.env.ANIME_HOST_MIN_INTERVAL_MS = '0';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const proxyEnv = ['PROXY', 'AS_PROXY', 'AW_PROXY', 'AU_PROXY'];
const savedProxy = Object.fromEntries(proxyEnv.map((key) => [key, process.env[key]]));
for (const key of proxyEnv) delete process.env[key];

let fetchCalls = 0;
// Il wrapper è quello catturato dal modulo; i test cambiano il comportamento
// dietro di lui (sostituire globalThis.fetch dopo l'import non avrebbe effetto).
let fetchBehavior = async () => { throw new Error('offline'); };
globalThis.fetch = async (input, init) => {
  fetchCalls += 1;
  return fetchBehavior(input, init);
};

const { fetchResource, providerRequestStore } = await import('../../dist/providers/anime-core/fetch-resource.js');
const { createCaches } = await import('../../dist/providers/anime-core/cache.js');
const { AnimeSaturnProvider } = await import('../../dist/providers/animesaturn-provider.js');

after(() => {
  for (const key of proxyEnv) {
    if (savedProxy[key] === undefined) delete process.env[key];
    else process.env[key] = savedProxy[key];
  }
});

test('AC3a: una fetch diretta fallita marca lo store', async () => {
  const store = { failed: false };
  fetchCalls = 0;
  await assert.rejects(
    providerRequestStore.run(store, () => fetchResource('http://flag-a.test/a', createCaches(), {}))
  );
  assert.equal(store.failed, true);
  assert.equal(fetchCalls, 1);
});

test('AC3c: agent null è tentativo finale, non hop di proxy', async () => {
  const store = { failed: false };
  fetchCalls = 0;
  await assert.rejects(
    providerRequestStore.run(store, () => fetchResource('http://flag-c.test/c', createCaches(), { agent: null }))
  );
  assert.equal(store.failed, true);
  assert.equal(fetchCalls, 1);
});

test('AC3e: due store che osservano lo stesso inflight marcano entrambi', async () => {
  const caches = createCaches();
  const storeA = { failed: false };
  const storeB = { failed: false };
  const previous = fetchBehavior;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  fetchBehavior = async () => {
    await gate;
    throw new Error('offline');
  };
  fetchCalls = 0;
  try {
    const pA = providerRequestStore.run(storeA, () => fetchResource('http://flag-e.test/e', caches, {}));
    const pB = providerRequestStore.run(storeB, () => fetchResource('http://flag-e.test/e', caches, {}));
    release();
    const results = await Promise.allSettled([pA, pB]);
    assert.deepEqual(results.map((result) => result.status), ['rejected', 'rejected']);
    assert.equal(storeA.failed, true);
    assert.equal(storeB.failed, true, 'senza `return await running` l\'osservatore non marca');
    assert.equal(fetchCalls, 1, 'le due richieste devono condividere lo stesso inflight');
  } finally {
    fetchBehavior = previous;
  }
});

test('isolamento: un provider fallito non marca lo store di un altro', async () => {
  // Due run con store distinti, entrambi vivi nello stesso istante: la marcatura
  // deve restare nel contesto async in cui è avvenuta la fetch fallita.
  const previous = fetchBehavior;
  const storeFail = { failed: false };
  const storeOk = { failed: false };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  fetchBehavior = async (input) => {
    await gate;
    const url = String(input);
    if (url.includes('flag-iso-fail.test')) throw new Error('offline');
    return new Response('ok', { status: 200, statusText: 'OK' });
  };
  try {
    const pFail = providerRequestStore.run(storeFail, () => fetchResource('http://flag-iso-fail.test/a', createCaches(), {}));
    const pOk = providerRequestStore.run(storeOk, () => fetchResource('http://flag-iso-ok.test/b', createCaches(), {}));
    release();
    const results = await Promise.allSettled([pFail, pOk]);
    assert.deepEqual(results.map((result) => result.status), ['rejected', 'fulfilled']);
    assert.equal(results[1].value, 'ok');
    assert.equal(storeFail.failed, true, 'il run che ha fallito marca il proprio store');
    assert.equal(storeOk.failed, false, 'lo store dell\'altro provider resta pulito');
  } finally {
    fetchBehavior = previous;
  }
});

test('AC3f: il cooldown 403 marca anche senza toccare la rete', async () => {
  const url = 'http://flag-f.test/f';
  const previous = fetchBehavior;
  let calls = 0;
  fetchBehavior = async () => {
    calls += 1;
    return new Response('forbidden', { status: 403, statusText: 'Forbidden' });
  };
  try {
    const storeA = { failed: false };
    await assert.rejects(providerRequestStore.run(storeA, () => fetchResource(url, createCaches(), {})));
    assert.equal(storeA.failed, true);
    assert.equal(calls, 1);

    const storeB = { failed: false };
    await assert.rejects(providerRequestStore.run(storeB, () => fetchResource(url, createCaches(), {})));
    assert.equal(storeB.failed, true);
    assert.equal(calls, 1, 'il cooldown non deve fare rete');
  } finally {
    fetchBehavior = previous;
  }
});

test('AC4: un provider reale non lancia e lascia failed=true', async () => {
  const store = { failed: false };
  const provider = new AnimeSaturnProvider({ enabled: true, proxyUrl: '', proxyPassword: '', tmdbApiKey: '' });
  fetchCalls = 0;
  const result = await providerRequestStore.run(store, () => provider.handleTitleRequest('Naruto', 1, 1, false));
  assert.deepEqual(result, { streams: [] });
  assert.equal(store.failed, true);
  assert.ok(fetchCalls >= 1, 'il provider deve aver tentato almeno una fetch');
});

test('lista vuota: guardia sul cache-set e fallimento fuori da fetchResource', () => {
  // Un provider che fallisce fuori da fetchResource restituisce { streams: [] }:
  // la guardia `streams.length === 0` in _providerCacheSet è ciò che impedisce
  // di cachare quel risultato (il flag non arriva lì, perimetro dichiarato).
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const source = fs.readFileSync(path.join(root, 'src', 'addon.ts'), 'utf8');

  const emptyGuardAt = source.search(/if\s*\(\s*!Array\.isArray\(\s*streams\s*\)\s*\|\|\s*streams\.length\s*===\s*0\s*\)\s*return\s*;/);
  const storeAt = source.search(/_providerStreamCache\.set\(\s*k\s*,/);
  const callAt = source.search(/_providerCacheSet\(\s*normalizedType\s*,/);

  assert.notEqual(emptyGuardAt, -1, 'una lista vuota non deve essere cachata');
  assert.notEqual(storeAt, -1, 'la scrittura in cache deve esistere');
  assert.ok(emptyGuardAt < storeAt, 'la guardia deve precedere la scrittura in cache');
  assert.notEqual(callAt, -1, 'il cache-set del fan-out deve esistere');
  assert.ok(emptyGuardAt < callAt, 'la guardia deve precedere il cache-set del fan-out');

  // Stesso motivo per il flag: la condizione del cache-set deve leggerlo.
  const conditionAt = source.lastIndexOf('if (', callAt);
  assert.ok(conditionAt !== -1 && conditionAt < callAt);
  assert.match(
    source.slice(conditionAt, callAt),
    /!providerFailure/,
    'il cache-set deve essere condizionato a !providerFailure'
  );
});

test('un titolo non risolvibile fuori da fetchResource produce [] senza throw', async () => {
  // english-title.ts lancia senza TMDB_API_KEY: il provider lo assorbe e torna
  // { streams: [] }. Nessuna fetch provider-site, quindi lo store resta pulito,
  // e la lista vuota non arriva comunque al cache-set.
  const provider = new AnimeSaturnProvider({ enabled: true, proxyUrl: '', proxyPassword: '', tmdbApiKey: '' });
  const store = { failed: false };
  fetchCalls = 0;
  const result = await providerRequestStore.run(store, () => provider.handleImdbRequest('tt9999999', 1, 1, false));
  assert.deepEqual(result, { streams: [] });
  assert.equal(store.failed, false, 'fallimento fuori da fetchResource: invisibile al flag (limite dichiarato)');
  assert.equal(fetchCalls, 0, 'nessuna fetch provider-site: la lista vuota nasce prima della rete');
});

test('AC5: addon.ts esegue l\'handler nello store e legge failed prima del cache-set', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const source = fs.readFileSync(path.join(root, 'src', 'addon.ts'), 'utf8');

  assert.match(
    source,
    /import\s*\{[^}]*\bproviderRequestStore\b[^}]*\}\s*from\s*['"]\.\/providers\/anime-core\/fetch-resource\.js['"]/,
    'addon.ts deve importare lo store da fetch-resource'
  );

  const storeAt = source.indexOf('const store = { failed: false }');
  const runs = [...source.matchAll(/providerRequestStore\.run\(/g)].map((match) => match.index);
  const markAt = source.search(/if\s*\(\s*store\.failed\s*\)\s*providerFailure\s*=\s*true/);
  const cacheSetAt = source.search(/if\s*\(\s*!providerFailure\s*&&\s*_providerConfigSig/);

  assert.notEqual(storeAt, -1, 'lo store deve essere creato in runProvider');
  assert.equal(runs.length, 2, 'handler dentro lo store in entrambi i rami (con e senza timeout)');
  assert.ok(runs[0] > storeAt && runs[1] > storeAt, 'lo store deve precedere entrambi i run');
  assert.notEqual(markAt, -1, 'providerFailure = true deve dipendere da store.failed');
  assert.ok(markAt > runs[1], 'la marcatura deve seguire l\'await');
  assert.notEqual(cacheSetAt, -1, 'la guardia del cache-set deve esistere');
  assert.ok(cacheSetAt > markAt, 'la marcatura deve precedere il cache-set');

  // Ramo timeout (addon.ts:405-415): il timer che vince fa rifiutare la
  // Promise.race e il catch di runProvider imposta providerFailure, quindi il
  // cache-set è già spento anche se lo store viene marcato in ritardo.
  const runProviderStart = source.indexOf('const runProvider =');
  const runProviderEnd = source.indexOf('const scheduleProviderRun');
  assert.ok(runProviderStart !== -1 && runProviderEnd > runProviderStart, 'il corpo di runProvider deve esistere');
  const runProviderSource = source.slice(runProviderStart, runProviderEnd);
  assert.match(
    runProviderSource,
    /Promise\.race\(\[\s*providerRequestStore\.run\(store,\s*\(\)\s*=>\s*handler\(\)\),\s*timeoutPromise\s*\]\)/,
    'ramo con timeout: l\'handler deve girare dentro lo store'
  );
  assert.match(
    runProviderSource,
    /result = await providerRequestStore\.run\(store,\s*\(\)\s*=>\s*handler\(\)\)/,
    'ramo senza timeout: l\'handler deve girare dentro lo store'
  );
  assert.match(
    runProviderSource,
    /catch\s*\(error\)\s*\{\s*providerFailure\s*=\s*true/,
    'il catch del runProvider (timeout compreso) deve impostare providerFailure'
  );
});
