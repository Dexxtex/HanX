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
