import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildTitleIndex,
  diffEntries,
  emptyCatalog,
  carryOverProgress,
  mergeSite,
  parseCardDetails,
  pendingEnrichment,
  parseCardIds,
  applyCardDetails,
  isEnrichmentFinal,
  parseSaturnAnimeSitemap,
  parseSaturnSitemapIndex,
  parseWorldMaxPage,
  parseUnityRecords,
  parseSaturnCardMeta,
  parseSaturnFilterPage,
  saturnListingGap,
  parseWorldFilterPage,
  readCatalog,
  shouldRunCatalogSync,
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
      anilist_id: 151514,
      type: 'TV',
      genres: ['Sport', 'Commedia'],
      plot: 'Un club di judo femminile che riparte da zero.',
      imageurl: 'https://img.animeunity.co/ippon.jpg',
      score: '8.2',
      studio: 'Bakken Record',
      status: 'Completato',
      day: 'Lunedì',
      episodes_count: 13,
      real_episodes_count: 13,
      episodes_length: 24,
      favorites: 1200,
      visite: 45000,
      members: 30000,
      created_at: '2023-01-10 09:15:00',
      crunchy_id: 0,
      netflix_id: 81345678,
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

const SATURN_PAGE = `<div class="grid">
  <a href="/anime/the-holy-grail-of-eris-Qqj3j" class="ac group">
    <div class="ac__poster"><span>8.60</span></div>
    <div class="ac__caption"><h3 class="ac__title">The Holy Grail of Eris</h3>
    <p class="ac__sub">08 Gennaio 2026 &middot; 12 ep</p></div>
  </a>
  <a href="/anime/the-holy-grail-of-eris-Qqj3j" class="ac group">
    <h3 class="ac__title">Doppione</h3>
  </a>
  <a href="/anime/senza-dati-Ux1" class="ac group">
    <h3 class="ac__title">Senza Dati</h3>
  </a>
  <a href="/toplist" class="ac">non una scheda</a>
</div>`;

const SATURN_CARD = `<html><head><script type="application/ld+json">{"@type":"TVSeries","name":"Tutor Hitman Reborn!","alternateName":"Katekyo Hitman Reborn!","description":"Tsuna &amp; i suoi amici.","genre":["Azione","Commedia"],"image":"https://img.saturncdn.net/r.jpg","datePublished":"2006","numberOfEpisodes":"203","aggregateRating":{"ratingValue":"8.1"}}</script></head>
<body><div class="ag-links"><a href="https://myanimelist.net/anime/1604/">MAL</a><a href="https://anilist.co/anime/1604/">AL</a></div></body></html>`;

const WORLD_CARD = `<html><head><script type="application/ld+json">{"@type":"TVEpisode","name":"MaR Episodio 1","episodeNumber":"1","partOfSeries":{"@type":"TVSeries","name":"MaR - Märchen Awakens Romance (ITA)","alternateName":"MÄR (ITA)"}}</script></head>
<body><a href="https://myanimelist.net/anime/738">MAL</a><a href="https://anilist.co/anime/738">AL</a></body></html>`;

test('scheda Saturn: alias, episodi, anno e id, senza trama e generi', () => {
  const details = parseCardDetails(SATURN_CARD, 'saturn');
  assert.deepEqual(details, {
    malId: 1604,
    anilistId: 1604,
    titles: ['Katekyo Hitman Reborn!'],
    episodes: 203,
    year: 2006,
  });
});

test('scheda World: il JSON-LD e un episodio, la serie sta in partOfSeries', () => {
  const details = parseCardDetails(WORLD_CARD, 'world');
  assert.deepEqual(details, { malId: 738, anilistId: 738, titles: ['MÄR (ITA)'] });
});

const WORLD_DL = `<dl><dt> Anno: </dt><dd> 2005 </dd><dt> Audio: </dt><dd> Italiano </dd><dt> Data di Uscita: </dt><dd> 03 Aprile 2005 </dd>
<dt> Stagione: </dt><dd> Primavera 2005 </dd><dt> Studio: </dt><dd> SynergySP </dd><dt> Episodi: </dt><dd> 102 </dd><dt> Stato: </dt><dd> Finito </dd></dl>`;

test('scheda Saturn: la lingua audio dichiarata vince sul suffisso del titolo', () => {
  const plain = SATURN_CARD.replace('</body>', '<div><span>Lingua</span> <span>Giapponese</span></div></body>');
  assert.equal(parseCardDetails(plain, 'saturn').language, 'SUB ITA');
  const dubbed = SATURN_CARD.replace('</body>', '<div><span>Lingua</span> <span>Italiano</span></div></body>');
  assert.equal(parseCardDetails(dubbed, 'saturn').language, 'ITA');
  // Scheda senza il campo: resta la deduzione dal titolo fatta dal matcher.
  assert.equal(parseCardDetails(SATURN_CARD, 'saturn').language, undefined);
});

test('scheda World: dal blocco informazioni anno, data, episodi e lingua audio', () => {
  const ita = parseCardDetails(WORLD_CARD + WORLD_DL, 'world');
  assert.equal(ita.episodes, 102);
  assert.equal(ita.year, 2005);
  assert.equal(ita.startDate, '2005-04-03');
  assert.equal(ita.language, 'ITA');

  // Audio originale: la scheda è sottotitolata, non doppiata.
  const sub = parseCardDetails(WORLD_CARD + WORLD_DL.replace('Italiano', 'Giapponese'), 'world');
  assert.equal(sub.language, 'SUB ITA');

  // I campi che non risolvono una richiesta non entrano.
  assert.equal(ita.studio, undefined);
  assert.equal(ita.plot, undefined);
});

test('scheda World: gli episodi si leggono da max del campo watchlist o dalla lista', () => {
  const withMax = `${WORLD_CARD}<input type="number" id="watchlist-edit-episodes" placeholder="0" min="0" max="12" value="">`;
  assert.equal(parseCardDetails(withMax, 'world').episodes, 12);

  const withList = `${WORLD_CARD}<a data-episode-num="0"></a><a data-episode-num="11"></a><a data-episode-num="12"></a>`;
  assert.equal(parseCardDetails(withList, 'world').episodes, 12);

  // Saturn non ha questo markup: il conteggio resta quello del JSON-LD.
  assert.equal(parseCardDetails(SATURN_CARD, 'saturn').episodes, 203);
});

test('scheda: i dati si fondono senza toccare il titolo del listing e il malId vuole la conferma', () => {
  const entry = { site: 'saturn', slug: 's', url: 'u', titleSite: 'Tutor Hitman Reborn' };
  applyCardDetails(entry, parseCardDetails(SATURN_CARD, 'saturn'), new Map());
  assert.equal(entry.titleSite, 'Tutor Hitman Reborn'); // il listing vince
  assert.deepEqual(entry.titles, ['Katekyo Hitman Reborn!']);
  assert.equal(entry.episodes, 203);
  assert.equal(entry.malId, undefined); // AniList non ha confermato

  const confirmed = { site: 'saturn', slug: 's', url: 'u', titleSite: 'Tutor Hitman Reborn' };
  applyCardDetails(confirmed, parseCardDetails(SATURN_CARD, 'saturn'), new Map([[1604, 1604]]));
  assert.equal(confirmed.malId, 1604);
  assert.equal(confirmed.anilistId, 1604);
});

test('arricchimento: esito definitivo solo se c\'era da chiedere e AniList ha risposto', () => {
  const malIdOnly = { malId: 738, anilistId: null };
  const anilistOnly = { malId: null, anilistId: 97938 };
  const both = { malId: 34566, anilistId: 97938 };
  // Senza link AniList non c'è niente da confermare: la scheda va chiusa, o
  // tornerebbe in testa alla coda a ogni run senza mai ottenere il malId.
  assert.equal(isEnrichmentFinal(malIdOnly, new Set()), true);
  assert.equal(isEnrichmentFinal(anilistOnly, new Set()), true);
  assert.equal(isEnrichmentFinal(both, new Set([97938])), true);
  assert.equal(isEnrichmentFinal(both, new Set()), false);
});

test('saturn: la copertura del listing sotto il 98% è un guasto, non un dettaglio', () => {
  assert.equal(saturnListingGap(6179, 6179), null);
  assert.equal(saturnListingGap(6055, 6179), null); // 98,0%
  assert.match(String(saturnListingGap(6054, 6179)), /listing con buchi: 6054\/6179/);
  assert.match(String(saturnListingGap(0, 10)), /minimo 9/);
});

test('saturn: dal listing titolo vero, data ISO, episodi e tipo della partizione', () => {
  const entries = parseSaturnFilterPage(SATURN_PAGE, 'TV');
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    site: 'saturn',
    slug: 'the-holy-grail-of-eris-Qqj3j',
    url: 'https://www.animesaturn.net/anime/the-holy-grail-of-eris-Qqj3j',
    titleSite: 'The Holy Grail of Eris',
    startDate: '2026-01-08',
    episodes: 12,
    type: 'TV',
  });
  assert.deepEqual(entries[1], {
    site: 'saturn',
    slug: 'senza-dati-Ux1',
    url: 'https://www.animesaturn.net/anime/senza-dati-Ux1',
    titleSite: 'Senza Dati',
    type: 'TV',
  });
});

test('saturn: data ed episodi si leggono anche da soli, e una data storta non passa', () => {
  assert.deepEqual(parseSaturnCardMeta('12 ep'), { episodes: 12 });
  assert.deepEqual(parseSaturnCardMeta('08 Gennaio 2026'), { startDate: '2026-01-08' });
  assert.deepEqual(parseSaturnCardMeta('In uscita'), {});
  assert.deepEqual(parseSaturnCardMeta(''), {});
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
      // data-jtitle diverso dal nome mostrato: finisce negli alias
      titles: ['MÄR (ITA)'],
    },
    {
      site: 'world',
      slug: 'absolute-duo',
      url: 'https://www.animeworld.ac/play/absolute-duo.yMPjX',
      titleSite: 'Absolute Duo',
    },
  ]);
});

test('unity: dub=1 dà la lingua esatta, dub=0 non la dichiara', () => {
  const { entries } = parseUnityRecords({
    tot: 2,
    records: [
      { id: 1, slug: 'ita-card', title: 'Alfa Sub ITA', dub: 1 },
      { id: 2, slug: 'sub-card', title: 'Beta', dub: 0 },
    ],
  });
  assert.equal(entries[0].language, 'ITA');
  assert.equal(entries[1].language, undefined);
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
    type: 'TV',
    malId: 52034,
    anilistId: 151514,
    season: 'inverno',
    episodes: 13,
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

test('arricchimento: prima le schede mai lette, e le fresche non si rileggono', () => {
  const e = (slug, enrichedAt) => ({ site: 'saturn', slug, url: '', titleSite: slug, ...(enrichedAt ? { enrichedAt } : {}) });
  const pending = pendingEnrichment(
    [e('vecchia', '2025-01-01'), e('nuova'), e('recente', '2026-11-03'), e('media', '2026-06-01')],
    '2026-11-05'
  );
  assert.deepEqual(pending.map((x) => x.slug), ['nuova', 'vecchia', 'media']);
});

test('ids della scheda: MAL e AniList, anche doppi come su World', () => {
  assert.deepEqual(
    parseCardIds('<div class="ag-links"><a href="https://myanimelist.net/anime/34566/">MAL</a><a href="https://anilist.co/anime/97938/">AL</a></div>'),
    { malId: 34566, anilistId: 97938 }
  );
  assert.deepEqual(
    parseCardIds('<a href="https://myanimelist.net/anime/738">x</a><a href="https://myanimelist.net/anime/738">y</a>'),
    { malId: 738, anilistId: null }
  );
  assert.deepEqual(parseCardIds('<a href="https://anilist.co/anime/0">zero</a>'), { malId: null, anilistId: null });
  assert.deepEqual(parseCardIds(''), { malId: null, anilistId: null });
});

test('malId: il crawl non li porta con sé, quindi si riprendono da ieri', () => {
  const previous = [
    { site: 'saturn', slug: 'a', url: '', titleSite: 'A', malId: 1 },
    { site: 'saturn', slug: 'b', url: '', titleSite: 'B' },
  ];
  const next = [
    { site: 'saturn', slug: 'a', url: '', titleSite: 'A' },
    { site: 'saturn', slug: 'b', url: '', titleSite: 'B', malId: 99 },
    { site: 'saturn', slug: 'nuova', url: '', titleSite: 'N' },
  ];
  assert.equal(carryOverProgress(previous, next), 1);
  assert.equal(next[0].malId, 1);
  assert.equal(next[1].malId, 99); // il dato fresco non si sovrascrive
  assert.equal(next[2].malId, undefined);

  const accepted = mergeSite('saturn', previous, next);
  assert.equal(accepted.entries[0].malId, 1);
});

test('mergeSite: la entry nuda del crawl non perde l arricchimento di ieri', () => {
  const previous = [
    {
      site: 'world',
      slug: 'a',
      url: 'u',
      titleSite: 'A',
      malId: 100,
      anilistId: 1,
      enrichedAt: '2026-11-04',
      language: 'ITA',
      episodes: 12,
      startDate: '2026-01-08',
      year: 2026,
      titles: ['Alias vecchio'],
    },
  ];
  const next = [
    { site: 'world', slug: 'a', url: 'u', titleSite: 'A', titles: ['Alias nuovo'] },
  ];
  const { entries } = mergeSite('world', previous, next);
  assert.equal(entries[0].enrichedAt, '2026-11-04');
  assert.equal(entries[0].language, 'ITA');
  assert.equal(entries[0].episodes, 12);
  assert.equal(entries[0].anilistId, 1);
  assert.equal(entries[0].malId, 100);
  assert.equal(entries[0].startDate, '2026-01-08');
  assert.equal(entries[0].year, 2026);
  assert.deepEqual(entries[0].titles, ['Alias nuovo', 'Alias vecchio']);
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
  // Il malId di Unity viaggia nell'indice: serve al match esatto.
  catalog.sites.unity = [{ site: 'unity', slug: '4354-mou-ippon', url: 'u', titleSite: 'Mou Ippon!', malId: 52034, episodes: 13 }];
  assert.equal(buildTitleIndex(catalog).sites.unity[0].malId, 52034);
  assert.equal(buildTitleIndex(catalog).sites.unity[0].episodes, 13);
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

test('shouldRunCatalogSync: dispatch forza il sync, intervallo minimo 16 ore', () => {
  const now = Date.parse('2026-11-08T20:00:00.000Z');

  // workflow_dispatch forza sempre l'esecuzione
  assert.equal(shouldRunCatalogSync({ eventName: 'workflow_dispatch', lastSyncRaw: '2026-11-08T19:30:00.000Z', nowMs: now }), true);

  // Marcatore assente o vuoto -> esegue
  assert.equal(shouldRunCatalogSync({ eventName: 'schedule', lastSyncRaw: '', nowMs: now }), true);
  assert.equal(shouldRunCatalogSync({ eventName: 'schedule', lastSyncRaw: null, nowMs: now }), true);

  // Sincronizzato 30 min prima -> salta
  assert.equal(shouldRunCatalogSync({ eventName: 'schedule', lastSyncRaw: '2026-11-08T19:30:00.000Z', nowMs: now }), false);

  // Sincronizzato 20 ore prima -> esegue
  assert.equal(shouldRunCatalogSync({ eventName: 'schedule', lastSyncRaw: '2026-11-08T00:00:00.000Z', nowMs: now }), true);

  // Timestamp numerico (secondi)
  const thirtyMinAgoSec = Math.floor((now - 30 * 60 * 1000) / 1000);
  assert.equal(shouldRunCatalogSync({ eventName: 'schedule', lastSyncRaw: String(thirtyMinAgoSec), nowMs: now }), false);

  // Formato legacy YYYY-MM-DD
  assert.equal(shouldRunCatalogSync({ eventName: 'schedule', lastSyncRaw: '2026-11-08', nowMs: now }), false);
  assert.equal(shouldRunCatalogSync({ eventName: 'schedule', lastSyncRaw: '2026-11-07', nowMs: now }), true);
});
