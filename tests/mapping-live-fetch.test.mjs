import assert from 'node:assert/strict';
import { test } from 'node:test';

const { fetchKitsuAnime } = await import('../dist/mapping/live.js');

const originalFetch = globalThis.fetch;

test('fetchJson: imposta un timeout e non ritenta un abort', async () => {
  let calls = 0;
  let signal;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    signal = init?.signal;
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  };

  try {
    await assert.rejects(fetchKitsuAnime('987654321'));
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls, 1);
  assert.ok(signal instanceof AbortSignal);
});
