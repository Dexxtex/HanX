// Il messaggio d'errore di fetchResource incorpora l'URL. Con un token in query
// (playlist AnimeSaturn, embed vixcloud) quel token finiva nei log di
// produzione: redactUrl toglie query e credenziali, il path resta.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { test } from 'node:test';

test("un fetch fallito non porta il token nel messaggio d'errore", async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('boom');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());

  const { fetchResource } = await import('../../dist/providers/anime-core/fetch-resource.js');
  const { createCaches } = await import('../../dist/providers/anime-core/cache.js');

  const token = 'segreto-che-non-deve-uscire';
  const url = `http://127.0.0.1:${server.address().port}/embed/playlist?token=${token}&expires=123`;

  await assert.rejects(
    () => fetchResource(url, createCaches(), { timeoutMs: 3000 }),
    (error) => {
      assert.ok(
        !error.message.includes(token),
        `il token è finito nel messaggio d'errore: ${error.message}`
      );
      assert.ok(
        error.message.includes('/embed/playlist'),
        `il path serve al debug e deve restare: ${error.message}`
      );
      return true;
    }
  );
});
