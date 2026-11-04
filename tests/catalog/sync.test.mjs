import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildTitleIndex,
  diffEntries,
  emptyCatalog,
  mergeSite,
  parseSaturnAnimeSitemap,
  parseSaturnSitemapIndex,
  parseWorldMaxPage,
  parseUnityRecords,
  parseWorldFilterPage,
  readCatalog,
  writeCatalogsAtomic,
} from '../../dist/catalog/sync.js';
import { compactKey } from '../../dist/catalog/text.js';

// Fixture: ritagli reali delle risposte del 4/11/2026, nessuna richiesta di rete.

const SATURN_INDEX = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://www.animesaturn.net/sitemap-pages.xml</loc></sitemap>
  <sitemap><loc>https://www.animesaturn.net/sitemap-anime-1.xml</loc></sitemap>
  <sitemap><loc>https://www.animesaturn.net/sitemap-episodes-1.xml</loc></sitemap>
</sitemapindex>`;

const SATURN_ANIME = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.animesaturn.net/anime/tutor-hitman-reborn-tuTL8</loc></url>
  <url><loc>https://www.animesaturn.net/anime/tutor-hitman-reborn-ita-V4SCx</loc></url>
  <url><loc>https://www.animesaturn.net/episode/tutor-hitman-reborn-tuTL8/ep-1</loc></url>
</urlset>`;

const WORLD_PAGE = `<div class="film-list">
  <div class="item"><div class="inner">
    <a href="/play/mar-marchen-awakens-romance-ita.BNESr" class="poster"><img alt="MaR - Märchen Awakens Romance (ITA)" /></a>
    <a href="/play/mar-marchen-awakens-romance-ita.BNESr" data-jtitle="MÄR (ITA)" class="name">MaR - Märchen Awakens Romance (ITA)</a>
  </div></div>
  <div class="item"><div class="inner">
    <a href="/play/mar-marchen-awakens-romance-ita.BNESr" class="poster"><img alt="doppione" /></a>
    <a href="/play/mar-marchen-awakens-romance-ita.BNESr" class="name">doppione</a>
  </div></div>
  <div class="item"><div class="inner">
    <a href="/play/absolute-duo.yMPjX" class="poster"><img alt="Absolute Duo" /></a>
    <a href="/play/absolute-duo.yMPjX" class="name">Absolute Duo</a>
  </div></div>
  <div class="item"><div class="inner"><a href="/news/1">non una scheda</a></div></div>
</div>`;

const UNITY_PAYLOAD = {
  tot: 9012,
  records: [
    {
      id: 4354,
      slug: 'mou-ippon',
      title: 'Mou Ippon!',
      title_eng: 'Mou Ippon!',
      title_it: 'Mou Ippon! Sub ITA',
      date: '2023',
      season: 'inverno',
      mal_id: 52034,
    },
    // Titolo principale vuoto (bug del sito su .hack): si usa l'italiano.
    { id: 830, slug: 'hackgu-returner', title: null, title_it: 'hack//G.U. Returner', title_eng: null, date: '2006' },
    { id: null, slug: 'senza-id', title: 'Senza id' },
  ],
};

test('saturn: il sitemap index tiene solo le parti anime', () => {
  assert.deepEqual(parseSaturnSitemapIndex(SATURN_INDEX), ['https://www.animesaturn.net/sitemap-anime-1.xml']);
  assert.deepEqual(parseSaturnSitemapIndex(''), []);
});

test('saturn: scheda dallo slug, gli episodi restano fuori', () => {
  const entries = parseSaturnAnimeSitemap(SATURN_ANIME);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    site: 'saturn',
    slug: 'tutor-hitman-reborn-tuTL8',
    url: 'https://www.animesaturn.net/anime/tutor-hitman-reborn-tuTL8',
    titleSite: 'Tutor Hitman Reborn',
  });
});

test('world: il sito dichiara quante pagine ha (paginationMaxPage)', () => {
  assert.equal(parseWorldMaxPage('<script>paginationMaxPage = parseInt("172");</script>'), 172);
  assert.equal(parseWorldMaxPage('<script>paginationMaxPage = parseInt("172")</script>'), 172);
  assert.equal(parseWorldMaxPage('<div class="film-list"></div>'), null);
  assert.equal(parseWorldMaxPage('paginationMaxPage = parseInt("0")'), null);
});

test('world: una pagina vuota è il segnale di fine (il tetto resta una sicurezza)', () => {
  // /filter?page=N oltre l'ultima pagina risponde 200 senza schede.
  assert.deepEqual(parseWorldFilterPage('<html><body><div class="film-list"></div></body></html>'), []);
  assert.deepEqual(parseWorldFilterPage(''), []);
});

test('world: una scheda per slug, titolo da a.name, link non-anime scartati', () => {
  const entries = parseWorldFilterPage(WORLD_PAGE);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries, [
    {
      site: 'world',
      slug: 'mar-marchen-awakens-romance-ita',
      url: 'https://www.animeworld.ac/play/mar-marchen-awakens-romance-ita.BNESr',
      titleSite: 'MaR - Märchen Awakens Romance (ITA)',
    },
    {
      site: 'world',
      slug: 'absolute-duo',
      url: 'https://www.animeworld.ac/play/absolute-duo.yMPjX',
      titleSite: 'Absolute Duo',
    },
  ]);
});

test('unity: titolo, titoli alternativi deduplicati, anno e url della scheda', () => {
  const { total, entries } = parseUnityRecords(UNITY_PAYLOAD);
  assert.equal(total, 9012);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    site: 'unity',
    slug: '4354-mou-ippon',
    url: 'https://www.animeunity.co/anime/4354-mou-ippon',
    titleSite: 'Mou Ippon!',
    titles: ['Mou Ippon! Sub ITA'],
    year: 2023,
    malId: 52034,
    season: 'inverno',
  });
  assert.deepEqual(entries[1], {
    site: 'unity',
    slug: '830-hackgu-returner',
    url: 'https://www.animeunity.co/anime/830-hackgu-returner',
    titleSite: 'hack//G.U. Returner',
    year: 2006,
  });
  assert.deepEqual(parseUnityRecords({ tot: 'x' }), { total: 0, entries: [] });
});

test('protezione: sotto il 70% il catalogo di ieri resta', () => {
  const previous = Array.from({ length: 100 }, (_, i) => ({ site: 'world', slug: `s${i}`, url: '', titleSite: `t${i}` }));
  const rejected = mergeSite('world', previous, previous.slice(0, 69));
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.entries, previous);
  assert.match(rejected.reason, /69 schede contro 100/);

  const accepted = mergeSite('world', previous, previous.slice(0, 70));
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.entries.length, 70);

  assert.equal(mergeSite('world', [], previous).accepted, true);
});

test('diff: aggiunte e rimosse rispetto a ieri', () => {
  const before = [
    { site: 'unity', slug: 'a', url: '', titleSite: 'A' },
    { site: 'unity', slug: 'b', url: '', titleSite: 'B' },
  ];
  const after = [
    { site: 'unity', slug: 'b', url: '', titleSite: 'B' },
    { site: 'unity', slug: 'c', url: '', titleSite: 'C' },
  ];
  assert.deepEqual(diffEntries(before, after), { added: 1, removed: 1 });
});

test('indice: chiave compatta, Mission-E e MissionE coincidono', () => {
  const catalog = emptyCatalog();
  catalog.generatedAt = '2026-11-04T19:00:00.000Z';
  catalog.sites.saturn = [
    { site: 'saturn', slug: 'mission-e-x1', url: 'u', titleSite: 'Mission-E' },
  ];
  const index = buildTitleIndex(catalog);
  assert.equal(index.sites.saturn[0].key, compactKey('Mission-E'));
  assert.equal(compactKey('Mission-E'), compactKey('MissionE'));
  assert.deepEqual(index.sites.world, []);
});

test('scrittura atomica: due file validi, nessun temporaneo lasciato', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hanx-catalog-'));
  const catalog = emptyCatalog();
  catalog.sites.unity = [{ site: 'unity', slug: 'a', url: 'u', titleSite: 'A' }];
  writeCatalogsAtomic(dir, catalog, buildTitleIndex(catalog));
  assert.deepEqual(fs.readdirSync(dir).sort(), ['catalog-titles.json', 'catalogs.json']);
  assert.deepEqual(readCatalog(dir).sites.unity, catalog.sites.unity);
  assert.deepEqual(readCatalog(path.join(dir, 'manca')).sites, { saturn: [], world: [], unity: [] });
  fs.rmSync(dir, { recursive: true, force: true });
});
