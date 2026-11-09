import assert from 'node:assert/strict';
import { test } from 'node:test';
const { minHostIntervalMs } = await import('../../dist/providers/anime-core/fetch-resource.js');
test('pacing: solo il letterale 0 lo spegne', () => {
  const cases = [[undefined, 1000], ['', 1000], ['   ', 1000], ['abc', 1000], ['-5', 1000], ['0', 0], ['1500', 1500]];
  for (const [raw, expected] of cases) {
    if (raw === undefined) delete process.env.ANIME_HOST_MIN_INTERVAL_MS;
    else process.env.ANIME_HOST_MIN_INTERVAL_MS = raw;
    assert.equal(minHostIntervalMs(), expected, `raw=${JSON.stringify(raw)}`);
  }
  delete process.env.ANIME_HOST_MIN_INTERVAL_MS;
});
