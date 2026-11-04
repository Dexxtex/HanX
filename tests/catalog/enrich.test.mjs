import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyCatalog } from '../../dist/catalog/sync.js';
import { enrichMalIds, enrichmentStalled } from '../../dist/catalog/enrich.js';

const TODAY = '2026-11-04';

// Finto AniList: conferma ogni anilistId che riceve con lo stesso numero.
function fakeAniList() {
  return async (url, init) => {
    const query = JSON.parse(init.body).query;
    const data = {};
    for (const [, alias, id] of query.matchAll(/(a\d+):Media\(id:(\d+),type:ANIME\)/g)) {
      data[alias] = { idMal: Number(id) };
    }
    return { ok: true, status: 200, json: async () => ({ data }) };
  };
}

// Scheda minima con entrambi i link (AniList 7 → MAL 7, confermabile) e una
// scheda con il solo link AniList: quella non ha niente da farsi confermare.
const PAGE = `<a href="https://anilist.co/anime/7"></a><a href="https://myanimelist.net/anime/7"></a>`;
const PAGE_NO_MAL = `<a href="https://anilist.co/anime/8"></a>`;

function catalogWith(entries) {
  const catalog = emptyCatalog();
  catalog.sites.saturn = entries.map((extra, index) => ({
    site: 'saturn',
    slug: `scheda-${index}`,
    url: `https://anime.test/scheda-${index}`,
    titleSite: `Scheda ${index}`,
    ...extra,
  }));
  return catalog;
}

test('arricchimento: conferma il malId, chiude la scheda, salta chi non ha id', async () => {
  const catalog = catalogWith([
    { anilistId: 7 },
    { enrichedAt: undefined },
  ]);
  const read = [];
  const result = await enrichMalIds(catalog, {
    readPage: async (entry) => {
      read.push(entry.slug);
      return entry.slug === 'scheda-0' ? PAGE : PAGE_NO_MAL;
    },
    isBlocked: () => false,
    quota: 10,
    deadline: Date.now() + 60_000,
    describe: () => '',
    today: TODAY,
    fetcher: fakeAniList(),
    delayMs: 0,
    log: () => {},
  });
  assert.equal(result.read, 2);
  assert.equal(result.pending, 2);
  // La prima scheda ha entrambi i link: malId confermato e scheda chiusa.
  assert.equal(catalog.sites.saturn[0].malId, 7);
  assert.equal(catalog.sites.saturn[0].enrichedAt, TODAY);
  // La seconda ha solo AniList: niente da confermare, ma la scheda è chiusa
  // (altrimenti resterebbe in testa alla coda per sempre).
  assert.equal(catalog.sites.saturn[1].malId, undefined);
  assert.equal(catalog.sites.saturn[1].enrichedAt, TODAY);
  assert.equal(enrichmentStalled(result), false);
});

test('arricchimento bloccato: zero lette su backlog non vuoto è un guasto', async () => {
  const catalog = catalogWith([{ anilistId: 7 }, {}]);
  const result = await enrichMalIds(catalog, {
    readPage: async () => {
      throw new Error('403 su https://anime.test/scheda-0');
    },
    isBlocked: () => true,
    quota: 10,
    deadline: Date.now() + 60_000,
    describe: (err) => String(err),
    today: TODAY,
    fetcher: fakeAniList(),
    delayMs: 0,
    log: () => {},
  });
  assert.equal(result.read, 0);
  assert.equal(result.pending, 2);
  assert.equal(enrichmentStalled(result), true);
  // Niente `enrichedAt`: la scheda si riprova appena il blocco passa.
  assert.equal(catalog.sites.saturn[0].enrichedAt, undefined);
});

test('scheda rotta che non è un blocco: si salta, la run continua', async () => {
  const catalog = catalogWith([{}, { anilistId: 7 }]);
  const read = [];
  const result = await enrichMalIds(catalog, {
    readPage: async (entry) => {
      read.push(entry.slug);
      if (read.length === 1) throw new Error('HTML mai visto');
      return PAGE;
    },
    isBlocked: () => false,
    quota: 10,
    deadline: Date.now() + 60_000,
    describe: () => '',
    today: TODAY,
    fetcher: fakeAniList(),
    delayMs: 0,
    log: () => {},
  });
  assert.equal(read.length, 2, 'la seconda scheda si legge comunque');
  assert.equal(result.read, 1);
  assert.equal(result.pending, 2);
  assert.equal(catalog.sites.saturn[1].malId, 7);
});

test('deadline già scaduta: non si legge niente e il backlog resta', async () => {
  const catalog = catalogWith([{ anilistId: 7 }]);
  const result = await enrichMalIds(catalog, {
    readPage: async () => PAGE,
    isBlocked: () => false,
    quota: 10,
    deadline: Date.now() - 1,
    describe: () => '',
    today: TODAY,
    fetcher: fakeAniList(),
    delayMs: 0,
    log: () => {},
  });
  assert.equal(result.read, 0);
  assert.equal(result.pending, 1);
  assert.equal(enrichmentStalled(result), true);
});

test('backlog vuoto: niente da leggere non è un guasto', async () => {
  const catalog = catalogWith([{ anilistId: 7, enrichedAt: TODAY }]);
  const result = await enrichMalIds(catalog, {
    readPage: async () => PAGE,
    isBlocked: () => false,
    quota: 10,
    deadline: Date.now() + 60_000,
    describe: () => '',
    today: TODAY,
    fetcher: fakeAniList(),
    delayMs: 0,
    log: () => {},
  });
  assert.equal(result.read, 0);
  assert.equal(result.pending, 0);
  assert.equal(enrichmentStalled(result), false);
});
