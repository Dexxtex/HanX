import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hanx-tenrai-test-'));
const cacheModule = await import(pathToFileURL(path.resolve('dist/providers/anime-core/tenrai-metadata.js')));
const { TenraiMetadataStore } = cacheModule;

let server;
let baseUrl;
let requestCount = 0;
let latestVersion = 1;
let respondWithError = false;
let respondWithRateLimit = false;
const requestHeaders = [];

before(async () => {
  server = createServer((req, res) => {
    requestCount += 1;
    requestHeaders.push(req.headers['if-none-match'] || null);

    if (respondWithRateLimit) {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '30' });
      res.end('{"error":"test rate limit"}');
      return;
    }

    if (respondWithError) {
      res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end('{"error":"test outage"}');
      return;
    }

    const etag = `W/"tenrai-test-${latestVersion}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag, 'cache-control': 'public, max-age=0' });
      res.end();
      return;
    }

    const title = latestVersion === 1 ? 'Cowboy Bebop' : 'Cowboy Bebop Updated';
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=0',
      etag,
    });
    res.end(JSON.stringify({
      data: {
        mal_id: 1,
        title,
        title_english: title,
        title_japanese: 'カウボーイビバップ',
        title_synonyms: [],
        titles: [
          { type: 'Default', title },
          { type: 'English', title },
        ],
      },
    }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
});

after(async () => {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await fs.promises.rm(tempRoot, { recursive: true, force: true });
});

function newStore(dbName) {
  return new TenraiMetadataStore({
    baseUrl,
    dbPath: path.join(tempRoot, dbName),
    timeoutMs: 2_000,
    cacheTtlMs: 0,
    negativeCacheTtlMs: 60_000,
    maxRequestsPerSecond: 4,
    maxRequestsPerMinute: 120,
    maxPendingRequests: 20,
    maxQueueWaitMs: 250,
    failureBackoffMs: 1_000,
    maxBackoffMs: 60_000,
  });
}

test('coalesces concurrent MAL lookups, persists ETags, revalidates 304, and replaces changed data', async () => {
  requestCount = 0;
  latestVersion = 1;
  respondWithError = false;
  respondWithRateLimit = false;
  requestHeaders.length = 0;

  const firstStore = newStore('etag.sqlite');
  let secondStore;
  try {
    const [first, concurrent, third] = await Promise.all([
      firstStore.get('1'),
      firstStore.get(1),
      firstStore.get('1'),
    ]);
    assert.equal(requestCount, 1, 'three simultaneous provider lookups should issue one HTTP request');
    assert.equal(first?.title_english, 'Cowboy Bebop');
    assert.equal(concurrent?.title_english, 'Cowboy Bebop');
    assert.equal(third?.title_english, 'Cowboy Bebop');
    firstStore.close();

    secondStore = newStore('etag.sqlite');
    const revalidated = await secondStore.get('1');
    assert.equal(requestCount, 2);
    assert.equal(requestHeaders[1], 'W/"tenrai-test-1"', 'the persisted ETag should be sent after restart');
    assert.equal(revalidated?.title_english, 'Cowboy Bebop');
    assert.equal(revalidated?.cacheStatus, 'revalidated');

    latestVersion = 2;
    const refreshed = await secondStore.get('1');
    assert.equal(requestCount, 3);
    assert.equal(refreshed?.title_english, 'Cowboy Bebop Updated');
    assert.equal(refreshed?.cacheStatus, 'updated');
  } finally {
    firstStore.close();
    secondStore?.close();
  }
});

test('serves the last good persistent title during an upstream outage', async () => {
  requestCount = 0;
  latestVersion = 1;
  respondWithError = false;
  respondWithRateLimit = false;

  const store = newStore('stale.sqlite');
  try {
    const saved = await store.get('1');
    assert.equal(saved?.title_english, 'Cowboy Bebop');

    respondWithError = true;
    const stale = await store.get('1');
    assert.equal(stale?.title_english, 'Cowboy Bebop');
    assert.equal(stale?.cacheStatus, 'stale');
    assert.equal(requestCount, 2);
  } finally {
    store.close();
  }
});

test('negative-caches a missing MAL ID to avoid repeated bad requests', async () => {
  requestCount = 0;
  respondWithRateLimit = false;
  respondWithError = false;

  const notFoundServer = createServer((_req, res) => {
    requestCount += 1;
    res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' });
    res.end('{"status":404}');
  });
  await new Promise((resolve, reject) => {
    notFoundServer.once('error', reject);
    notFoundServer.listen(0, '127.0.0.1', resolve);
  });

  const missingStore = new TenraiMetadataStore({
    baseUrl: `http://127.0.0.1:${notFoundServer.address().port}/v1`,
    dbPath: path.join(tempRoot, 'not-found.sqlite'),
    maxRequestsPerSecond: 4,
    maxRequestsPerMinute: 120,
  });
  try {
    assert.equal(await missingStore.get('99999999'), null);
    assert.equal(await missingStore.get('99999999'), null);
    assert.equal(requestCount, 1);
  } finally {
    missingStore.close();
    await new Promise((resolve) => notFoundServer.close(resolve));
  }
});

test('respects Retry-After globally and serves cached metadata while rate-limited', async () => {
  requestCount = 0;
  latestVersion = 1;
  respondWithError = false;
  respondWithRateLimit = false;

  const store = newStore('retry-after.sqlite');
  try {
    const initial = await store.get('1');
    assert.equal(initial?.title_english, 'Cowboy Bebop');

    respondWithRateLimit = true;
    const stale = await store.get('1');
    assert.equal(stale?.title_english, 'Cowboy Bebop');
    assert.equal(stale?.cacheStatus, 'stale');

    const duringCooldown = await store.get('1');
    assert.equal(duringCooldown?.title_english, 'Cowboy Bebop');
    await assert.rejects(store.get('2'), (error) => error.retryAfterMs >= 28_000);
    assert.equal(requestCount, 2, 'Retry-After must block other MAL IDs too');
  } finally {
    store.close();
  }
});

test('a successful concurrent response cannot clear a Retry-After cooldown', async () => {
  let requests = 0;
  const rateRaceServer = createServer((req, res) => {
    requests += 1;
    const id = new URL(req.url, 'http://localhost').pathname.split('/').pop();
    if (id === '1') {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '30' });
      res.end('{"error":"rate limited"}');
      return;
    }
    setTimeout(() => {
      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=60',
        etag: 'W/"rate-race"',
      });
      res.end(JSON.stringify({ data: {
        mal_id: Number(id),
        title: `Anime ${id}`,
        title_english: `Anime ${id}`,
        titles: [{ type: 'English', title: `Anime ${id}` }],
      } }));
    }, 100);
  });
  await new Promise((resolve, reject) => {
    rateRaceServer.once('error', reject);
    rateRaceServer.listen(0, '127.0.0.1', resolve);
  });

  const store = new TenraiMetadataStore({
    baseUrl: `http://127.0.0.1:${rateRaceServer.address().port}/v1`,
    dbPath: path.join(tempRoot, 'rate-race.sqlite'),
    maxRequestsPerSecond: 4,
    maxRequestsPerMinute: 120,
    maxQueueWaitMs: 250,
    failureBackoffMs: 1_000,
    maxBackoffMs: 60_000,
  });
  try {
    const [limited, successful] = await Promise.allSettled([store.get('1'), store.get('2')]);
    assert.equal(limited.status, 'rejected');
    assert.equal(successful.status, 'fulfilled');
    assert.equal(successful.value?.title_english, 'Anime 2');

    await assert.rejects(store.get('3'), (error) => error.retryAfterMs >= 28_000);
    assert.equal(requests, 2, 'the in-flight success must not erase the global 429 cooldown');
  } finally {
    store.close();
    await new Promise((resolve) => rateRaceServer.close(resolve));
  }
});

test('persists the per-IP request budget across store restarts', async () => {
  requestCount = 0;
  latestVersion = 1;
  respondWithError = false;
  respondWithRateLimit = false;

  const dbPath = path.join(tempRoot, 'rate-limit.sqlite');
  const firstStore = new TenraiMetadataStore({
    baseUrl,
    dbPath,
    cacheTtlMs: 0,
    maxRequestsPerSecond: 4,
    maxRequestsPerMinute: 1,
    maxPendingRequests: 10,
    maxQueueWaitMs: 250,
  });
  let restartedStore;
  try {
    await firstStore.get('1');
    firstStore.close();

    restartedStore = new TenraiMetadataStore({
      baseUrl,
      dbPath,
      cacheTtlMs: 0,
      maxRequestsPerSecond: 4,
      maxRequestsPerMinute: 1,
      maxPendingRequests: 10,
      maxQueueWaitMs: 250,
    });
    await assert.rejects(restartedStore.get('2'), /queue is saturated/);
    assert.equal(requestCount, 1, 'the persisted per-minute budget must block a second outbound request');
  } finally {
    firstStore.close();
    restartedStore?.close();
  }
});
