import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { test } from 'node:test';

test('un fallback diretto in cache non evita il proxy al fetch successivo', async (t) => {
  let proxyHits = 0;
  let targetHits = 0;
  let proxyShouldFail = true;

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
    if (proxyShouldFail) {
      proxyShouldFail = false;
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('proxy down');
      return;
    }
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
  const { auFetchResource } = await import('../../dist/providers/animeunity-provider.js');
  const { createCaches } = await import('../../dist/providers/anime-core/cache.js');
  const caches = createCaches();
  const url = `http://127.0.0.1:${target.address().port}/test`;

  const first = await auFetchResource(url, caches, { ttlMs: 60_000, timeoutMs: 2000 });
  assert.equal(first, 'direct');
  assert.equal(proxyHits, 1);
  assert.equal(targetHits, 1);

  const second = await auFetchResource(url, caches, { ttlMs: 60_000, timeoutMs: 2000 });
  assert.equal(second, 'proxied');
  assert.equal(proxyHits, 2, 'il secondo fetch deve ritentare il proxy');
  assert.equal(targetHits, 1, 'la cache del fallback diretto non deve coprire il proxy');
});
