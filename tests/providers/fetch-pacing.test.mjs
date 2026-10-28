// Un host alla volta con un minimo tra le richieste: le raffiche fanno scattare
// il WAF. File separato perche' l'intervallo e' letto da env e le attese sono
// misurate.
process.env.ANIME_HOST_MIN_INTERVAL_MS = '120';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchResource } from '../../dist/providers/anime-core/fetch-resource.js';
import { createCaches } from '../../dist/providers/anime-core/cache.js';

test('due richieste allo stesso host rispettano l\'intervallo e non si sovrappongono', async () => {
  let inFlight = 0;
  let overlapped = false;
  const server = http.createServer((_req, res) => {
    inFlight += 1;
    if (inFlight > 1) overlapped = true;
    setTimeout(() => {
      inFlight -= 1;
      res.writeHead(200).end('ok');
    }, 30);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const caches = createCaches();

  try {
    const startedAt = Date.now();
    // Tre richieste diverse, lanciate insieme: devono uscire in fila.
    const bodies = await Promise.all([
      fetchResource(`${base}/a`, caches),
      fetchResource(`${base}/b`, caches),
      fetchResource(`${base}/c`, caches),
    ]);
    const elapsed = Date.now() - startedAt;
    assert.deepEqual(bodies, ['ok', 'ok', 'ok']);
    assert.equal(overlapped, false, 'due richieste allo stesso host in parallelo');
    // 3 richieste = 2 attese da 120 ms.
    assert.ok(elapsed >= 220, `atteso >= 220 ms, misurato ${elapsed}`);
  } finally {
    server.close();
  }
});
