import assert from 'node:assert/strict';
import { test } from 'node:test';

const { collectProviderStreams } = await import('../../dist/stream.js');

const stream = (name) => ({ name, url: `https://example.test/${name}` });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// La 1.1.6 aggiunse un budget di risposta qui: su una serie mai vista nessun
// provider finiva in tempo e la lista usciva con 0-2 provider su 3. Questo test
// è comportamentale: se qualcuno rimette un tetto, il provider lento sparisce.
test('aspetta il provider lento invece di tagliare la lista', async () => {
  const started = Date.now();
  const result = await collectProviderStreams([
    Promise.resolve([stream('veloce-1')]),
    sleep(80).then(() => [stream('lento')]),
    Promise.resolve([stream('veloce-2')]),
  ]);
  const elapsed = Date.now() - started;

  assert.deepEqual(result.map((s) => s.name).sort(), ['lento', 'veloce-1', 'veloce-2']);
  assert.ok(elapsed >= 70, `deve aspettare il lento (${elapsed} ms)`);
});

test('un provider che restituisce niente non toglie gli altri', async () => {
  const result = await collectProviderStreams([
    Promise.resolve([]),
    Promise.resolve([stream('a')]),
    Promise.resolve([]),
  ]);
  assert.deepEqual(result.map((s) => s.name), ['a']);
});

test('una risposta malformata non fa cadere il fan-out', async () => {
  const result = await collectProviderStreams([
    Promise.resolve(null),
    Promise.resolve([stream('a')]),
  ]);
  assert.deepEqual(result.map((s) => s.name), ['a']);
});
