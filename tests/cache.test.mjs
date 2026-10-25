import assert from 'node:assert/strict';
import { test } from 'node:test';

const { getCached, setCached } = await import('../dist/providers/anime-core/cache.js');

test('setCached scarta le entry scadute e limita la mappa a 500', () => {
  const map = new Map();
  // Una entry scaduta deve sparire durante l'eviction.
  map.set('expired', { value: 'old', expiresAt: Date.now() - 1000 });
  for (let i = 0; i < 600; i += 1) {
    setCached(map, `k${i}`, i, 60_000);
  }
  assert.equal(map.size, 500);
  assert.equal(map.has('expired'), false);
  assert.equal(map.has('k0'), false);
  assert.equal(map.has('k599'), true);
  assert.equal(getCached(map, 'k599'), 599);
});
