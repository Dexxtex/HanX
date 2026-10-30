// AC3b: un hop di proxy fallito non è un fallimento del provider. Fetch reale
// (nessuno stub: gli hop con ProxyAgent passano da undiciFetch). File separato
// perché il cooldown 403 è per processo e usa solo l'hostname: il 403 del proxy
// su 127.0.0.1 avvelenerebbe ogni altro test che usa server locali.
process.env.ANIME_HOST_MIN_INTERVAL_MS = '0';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { test } from 'node:test';

test('un hop di proxy fallito non marca lo store', async (t) => {
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

  const savedProxy = process.env.PROXY;
  t.after(() => {
    if (savedProxy === undefined) delete process.env.PROXY;
    else process.env.PROXY = savedProxy;
    proxy.close();
    target.close();
  });

  process.env.PROXY = `http://127.0.0.1:${proxy.address().port}`;
  const { fetchResource, providerRequestStore } = await import('../../dist/providers/anime-core/fetch-resource.js');
  const { createCaches } = await import('../../dist/providers/anime-core/cache.js');

  const store = { failed: false };
  const body = await providerRequestStore.run(store, () => fetchResource(
    `http://127.0.0.1:${target.address().port}/test`,
    createCaches(),
    { timeoutMs: 3000 }
  ));

  assert.equal(body, 'direct');
  assert.equal(store.failed, false, 'un hop fallito seguito dal diretto riuscito non è un fallimento');
  assert.equal(proxyHits, 1, 'il proxy deve essere tentato');
  assert.equal(targetHits, 1, 'il diretto deve essere usato');
});
