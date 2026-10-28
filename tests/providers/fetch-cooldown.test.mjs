// Il 403 di Cloudflare non si insiste: dopo il primo rifiuto quell'uscita viene
// saltata, cosi' i ripieghi dei provider non rinnovano il blocco. Il cooldown e'
// per host E uscita: se il proxy viene bloccato, il diretto deve restare
// utilizzabile (e viceversa).
// File separato: il cooldown e' per processo.
process.env.ANIME_HOST_MIN_INTERVAL_MS = '0';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchResource } from '../../dist/providers/anime-core/fetch-resource.js';
import { createCaches } from '../../dist/providers/anime-core/cache.js';

test('dopo un 403 l\'uscita va in cooldown, le altre restano libere', async () => {
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits += 1;
    res.writeHead(403).end('forbidden');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/filter?key=haruhi`;
  const caches = createCaches();

  try {
    // Prima uscita: rifiutata una volta, poi saltata senza rete.
    await assert.rejects(() => fetchResource(url, caches, { exitLabel: 'AS_PROXY' }), /HTTP 403/);
    await assert.rejects(() => fetchResource(url, caches, { exitLabel: 'AS_PROXY' }), /cooldown/);
    assert.equal(hits, 1);
    // Uscita diversa (il diretto): il blocco del proxy non la spegne.
    await assert.rejects(() => fetchResource(url, caches), /HTTP 403/);
    assert.equal(hits, 2);
  } finally {
    server.close();
  }
});
