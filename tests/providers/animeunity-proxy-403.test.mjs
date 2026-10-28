// Il 403 del proxy appartiene all'uscita che l'ha ricevuto: il percorso diretto
// della stessa richiesta deve restare libero. File separato: il cooldown e'
// per processo e il primo test di animeunity-proxy-order lo sporcherebbe.
process.env.ANIME_HOST_MIN_INTERVAL_MS = '0';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { test } from 'node:test';

test('un 403 del proxy non mette in cooldown il percorso diretto', async (t) => {
  let targetHits = 0;
  let proxyHits = 0;

  const target = http.createServer((_req, res) => {
    targetHits += 1;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('direct');
  });
  target.listen(0, '127.0.0.1');
  await once(target, 'listening');

  const proxy = http.createServer((req, res) => {
    proxyHits += 1;
    req.resume();
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('forbidden');
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');

  t.after(() => {
    delete process.env.AU_PROXY;
    proxy.close();
    target.close();
  });

  process.env.AU_PROXY = `http://127.0.0.1:${proxy.address().port}`;
  const { auFetchResource } = await import('../../dist/providers/animeunity-provider.js');
  const { createCaches } = await import('../../dist/providers/anime-core/cache.js');

  const body = await auFetchResource(
    `http://127.0.0.1:${target.address().port}/test`,
    createCaches(),
    { timeoutMs: 3000 }
  );

  assert.equal(body, 'direct');
  assert.equal(proxyHits, 1, 'il proxy deve essere tentato');
  assert.equal(targetHits, 1, 'il 403 del proxy non deve bloccare il diretto');
});
