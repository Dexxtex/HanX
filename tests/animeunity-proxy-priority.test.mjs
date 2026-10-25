import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { test } from 'node:test';

test('AU_PROXY precede il proxy globale', async (t) => {
  let globalHits = 0;
  let auHits = 0;

  const globalProxy = http.createServer((req, res) => {
    globalHits += 1;
    req.resume();
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('global');
  });
  globalProxy.listen(0, '127.0.0.1');
  await once(globalProxy, 'listening');

  const auProxy = http.createServer((req, res) => {
    auHits += 1;
    req.resume();
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('au');
  });
  auProxy.listen(0, '127.0.0.1');
  await once(auProxy, 'listening');

  t.after(() => {
    globalProxy.close();
    auProxy.close();
  });

  process.env.PROXY = `http://127.0.0.1:${globalProxy.address().port}`;
  process.env.AU_PROXY = `http://127.0.0.1:${auProxy.address().port}`;
  process.env.SEARCH_VIA_PROXY = 'true';

  const { auFetchResource } = await import('../dist/providers/animeunity-provider.js');
  const { createCaches } = await import('../dist/providers/anime-core/cache.js');

  const body = await auFetchResource('http://target.invalid/test', createCaches(), { timeoutMs: 3000 });

  assert.equal(body, 'au');
  assert.equal(auHits, 1, 'AU_PROXY deve essere il primo hop');
  assert.equal(globalHits, 0, 'il proxy globale non deve essere usato se AU_PROXY risponde');
});
