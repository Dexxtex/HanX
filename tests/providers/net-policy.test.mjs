import assert from 'node:assert/strict';
import { test } from 'node:test';

const { exitKeyFor, isCoolingDown, cooldownFor, hostOf, minHostIntervalMs } = await import(
  '../../dist/providers/anime-core/net-policy.js'
);

// La politica di rete stava dentro fetch-resource insieme al trasporto. Qui non
// si fa nessuna richiesta: si decide quando e se una richiesta può partire.

test('la chiave del cooldown separa le uscite: un 403 via proxy non spegne il diretto', () => {
  const host = 'www.animesaturn.net';
  assert.notEqual(exitKeyFor('AS_PROXY', host), exitKeyFor(undefined, host));
  assert.equal(exitKeyFor(undefined, host), `diretto:${host}`);
});

test('un 403 mette in pausa solo quell\'uscita', () => {
  const host = 'example.test';
  const viaProxy = exitKeyFor('AS_PROXY', host);
  const diretto = exitKeyFor(undefined, host);
  cooldownFor(viaProxy, 403);
  assert.equal(isCoolingDown(viaProxy), true);
  assert.equal(isCoolingDown(diretto), false, 'il diretto resta libero');
});

test('un 429 dura meno di un 403', () => {
  const a = exitKeyFor('A', 'h1');
  const b = exitKeyFor('B', 'h1');
  const now = Date.now();
  cooldownFor(a, 403, now);
  cooldownFor(b, 429, now);
  assert.equal(isCoolingDown(a, now + 5 * 60 * 1000), true, 'il 403 dura 10 minuti');
  assert.equal(isCoolingDown(b, now + 5 * 60 * 1000), false, 'il 429 dura 1 minuto');
});

test('hostOf non lancia su un URL rotto', () => {
  assert.equal(hostOf('non-un-url'), '');
  assert.equal(hostOf('https://example.test/x'), 'example.test');
});

test('il pacing non si spegne con una variabile vuota', () => {
  process.env.ANIME_HOST_MIN_INTERVAL_MS = '';
  assert.equal(minHostIntervalMs(), 1000);
  delete process.env.ANIME_HOST_MIN_INTERVAL_MS;
});
