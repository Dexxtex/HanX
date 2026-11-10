import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getCached, setCached } from '../../dist/providers/anime-core/cache.js';

test('rinfrescare una chiave la sposta in coda: non viene sfrattata per prima', () => {
  const map = new Map();
  // Riempie la cache oltre il tetto (500) tenendo "calda" la prima chiave.
  for (let i = 0; i < 500; i++) setCached(map, `k${i}`, `v${i}`, 60_000);
  setCached(map, 'k0', 'v0-rinfrescato', 60_000);
  for (let i = 500; i < 560; i++) setCached(map, `k${i}`, `v${i}`, 60_000);
  assert.equal(getCached(map, 'k0'), 'v0-rinfrescato', 'la voce rinfrescata deve sopravvivere');
});

// Le voci a TTL lungo (le ricerche, 12 h) si inseriscono una volta e non si
// riscrivono: con lo sfratto per ordine di inserimento erano le prime a morire
// mentre quelle a 2 minuti restavano. Si sfratta per scadenza più vicina.
test('sfratto per scadenza più vicina, non per ordine di inserimento', () => {
  const map = new Map();
  // 400 voci "preziose" a 12 h, inserite per prime.
  for (let i = 0; i < 400; i++) setCached(map, `long${i}`, `v${i}`, 12 * 60 * 60 * 1000);
  // Poi 200 voci effimere a 2 minuti.
  for (let i = 0; i < 200; i++) setCached(map, `short${i}`, `v${i}`, 2 * 60 * 1000);

  assert.equal(map.size, 500, 'il tetto resta 500');
  assert.equal(getCached(map, 'long0'), 'v0', 'la voce a TTL lungo non deve morire per prima');
  assert.equal(getCached(map, 'long399'), 'v399');
  assert.equal(getCached(map, 'short0'), undefined, 'si sfrattano le effimere, a partire dalla scadenza più vicina');
  const shortLeft = [...map.keys()].filter((key) => key.startsWith('short')).length;
  assert.equal(shortLeft, 100, 'sono morte 100 effimere, non 100 voci a TTL lungo');
});
