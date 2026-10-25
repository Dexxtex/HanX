import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { test } from 'node:test';

test('auFetchResource usa AU_PROXY come primo percorso e non tocca il diretto', async (t) => {
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
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('proxied');
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');

  t.after(() => {
    proxy.close();
    target.close();
  });

  process.env.AU_PROXY = `http://127.0.0.1:${proxy.address().port}`;
  process.env.SEARCH_VIA_PROXY = 'true';
  const { auFetchResource } = await import('../dist/providers/animeunity-provider.js');
  const { createCaches } = await import('../dist/providers/anime-core/cache.js');

  const body = await auFetchResource(
    `http://127.0.0.1:${target.address().port}/test`,
    createCaches(),
    { timeoutMs: 3000 }
  );

  assert.equal(body, 'proxied');
  assert.equal(proxyHits, 1, 'il proxy deve ricevere la richiesta');
  assert.equal(targetHits, 0, 'il percorso diretto non deve essere tentato');
});
