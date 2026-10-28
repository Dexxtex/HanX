import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hanx-mapping-'));
const fixtureFile = path.join(fixtureDir, 'anime-seasons.json');

fs.writeFileSync(fixtureFile, JSON.stringify({
  version: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  series: {
    // Numerazione a passi: l'episodio 6 del sito è il 7 di Kitsu (episodio
    // inserito prima). L'offset è negativo ma la mappatura è giusta.
    'tvdb:90001': {
      title: 'Beatless',
      seasons: {
        '1': [
          { from: 1, kitsuId: '13939', offset: 0, title: 'Beatless', episodeCount: 20 },
          { from: 6, kitsuId: '13939', offset: -1, title: 'Beatless', episodeCount: 20 },
        ],
      },
    },
    // Range di stagione 0 costruito male: riusa il kitsuId della madre.
    'tvdb:90002': {
      title: 'Beatless',
      seasons: {
        '0': [{ from: 1, kitsuId: '13939', offset: -5, title: 'Beatless', episodeCount: 20 }],
        '1': [{ from: 1, kitsuId: '13939', offset: 0, title: 'Beatless', episodeCount: 20 }],
      },
    },
    // Special con una entry propria: l'offset negativo è un passo legittimo.
    'tvdb:90003': {
      title: 'Princess Lover!',
      seasons: {
        '0': [{ from: 2, kitsuId: '4987', offset: -2, title: 'Princess Lover! Picture Drama', episodeCount: 6 }],
        '1': [{ from: 1, kitsuId: '4471', offset: 0, title: 'Princess Lover!', episodeCount: 12 }],
      },
    },
    'imdb:tt2560140': {
      title: 'Attack on Titan',
      seasons: {
        '3': [{ from: 13, kitsuId: '41982', offset: 12, title: 'Attack on Titan Season 3 Part 2', episodeCount: 10 }],
        '4': [
          { from: 17, kitsuId: '44240', offset: 16, title: 'Attack on Titan: The Final Season', episodeCount: 16 },
          { from: 29, kitsuId: '46038', offset: 28, title: 'Attack on Titan: The Final Season Part 2', episodeCount: 12 },
        ],
      },
    },
    'tmdb:95479': {
      title: 'Attack on Titan',
      seasons: {
        '1': [
          { from: 48, kitsuId: '48363', offset: 47, title: 'Attack on Titan Season 3 Part 2', episodeCount: 10 },
          { from: 60, kitsuId: '50627', offset: 59, title: 'Attack on Titan: The Final Season', episodeCount: 16 },
        ],
      },
    },
    'tmdb:207468': {
      title: 'Kaiju No. 8',
      seasons: { '1': [{ from: 13, kitsuId: '48994', offset: 12, title: 'Kaiju No. 8 Part 2', episodeCount: 12 }] },
    },
    'tvdb:377543': {
      title: 'Attack on Titan',
      seasons: { '3': [{ from: 13, kitsuId: '50627', offset: 12, title: 'Attack on Titan: The Final Season', episodeCount: 16 }] },
    },
    'tvdb:267440': {
      title: 'Attack on Titan',
      titleIt: "L'attacco dei giganti",
      seasons: { '2': [{ from: 1, kitsuId: '8671', offset: 0, title: 'Attack on Titan Season 2', episodeCount: 12 }] },
    },
    // Mappata col solo TMDB: nessun kitsuId, il titolo è ciò che i provider cercano.
    'tmdb:70000': {
      title: 'Mezzo Forte',
      titleIt: 'Mezzo Forte (IT)',
      seasons: {
        '0': [{ from: 1, kitsuId: '999', offset: 0, title: 'Mezzo Forte Special', titleAlt: 'Mezzo Forte Special Romaji', episodeCount: 1 }],
        '1': [{ from: 1, kitsuId: '', offset: 0, title: 'Mezzo Forte', titleAlt: 'Mezzo Forte', episodeCount: 2 }],
      },
    },
    // Una special che porta il titolo della madre: cercarla porterebbe alla serie.
    'tmdb:80000': {
      title: 'Power Stone',
      seasons: { '0': [{ from: 1, kitsuId: '555', offset: 0, title: 'Power Stone', episodeCount: 1 }] },
    },
    // Come Cowboy Bebop: il titolo TVDB è giapponese, il range porta l'italiano
    // della madre. Il nome giapponese non basta a riconoscerlo.
    'tvdb:76885': {
      title: 'カウボーイビバップ',
      titleIt: 'Cowboy Bebop',
      seasons: { '0': [{ from: 1, kitsuId: '1', offset: 0, title: 'Cowboy Bebop', episodeCount: 26 }] },
    },
    // TMDB it-IT che restituisce il titolo giapponese al posto dell'italiano.
    'tvdb:83000': {
      title: 'ファントム THE ANIMATION',
      titleIt: 'ファントム THE ANIMATION',
      seasons: { '1': [{ from: 1, kitsuId: '42', offset: 0, title: 'Phantom: The Animation', episodeCount: 3 }] },
    },
    // Offset negativo: numerazione sfasata da una special, non va usata.
    'tmdb:81000': {
      title: 'Shifted',
      seasons: { '1': [{ from: 14, kitsuId: '777', offset: -1, title: 'Shifted', episodeCount: 13 }] },
    },
  },
  movies: {
    'tmdb:372058': { kitsuId: '11614', title: 'Your Name.', titleAlt: 'Kimi no Na wa.', titleIt: 'Your Name. - Il tuo nome.' },
    'imdb:tt5311514': { kitsuId: '11614', title: 'Your Name.', titleIt: 'Your Name. - Il tuo nome.' },
    'tmdb:41000': { kitsuId: '', title: 'Masquerade', titleAlt: 'Masquerade', titleIt: 'Masquerade' },
  },
}, null, 2));

process.env.ANIME_MAPPING_FILE = fixtureFile;

const { parseRequestId, resolveMappingRequest, toNumericId } = await import('../../dist/mapping/request.js');
const { resolveLocalTarget, resolveSeasonFallbackTitle, getMappingVersion, resetMappingCache } = await import('../../dist/mapping/index.js');
const { resolveLiveTarget } = await import('../../dist/mapping/live.js');

function targetFor(id) {
  const request = resolveMappingRequest(id);
  assert.ok(request, `request must parse: ${id}`);
  const target = resolveLocalTarget(request);
  assert.ok(target, `target must resolve: ${id}`);
  return target;
}

test('local mapping resolves IMDb series seasons and split cours', () => {
  assert.equal(typeof getMappingVersion(), 'string');
  assert.notEqual(getMappingVersion(), 'empty');

  let target = targetFor('imdb:tt2560140:3:13');
  assert.equal(target.kitsuId, '41982');
  assert.equal(target.kitsuEpisode, 1);
  assert.equal(target.displaySeason, 3);
  assert.equal(target.source, 'local');
  assert.equal(target.title, 'Attack on Titan Season 3 Part 2');

  target = targetFor('imdb:tt2560140:4:17');
  assert.equal(target.kitsuId, '44240');
  assert.equal(target.kitsuEpisode, 1);
  assert.equal(target.title, 'Attack on Titan: The Final Season');

  target = targetFor('imdb:tt2560140:4:29');
  assert.equal(target.kitsuId, '46038');
  assert.equal(target.kitsuEpisode, 1);
  // The entry title must be used, not the TVDB series title.
  assert.equal(target.title, 'Attack on Titan: The Final Season Part 2');

  assert.equal(targetFor('tt2560140:4:30').kitsuEpisode, 2);
});

test('split-cour fallback uses the official season title, never the base series', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.match(String(input), /\/tv\/95479\/season\/4\?api_key=test-key/);
    return { ok: true, json: async () => ({ name: 'The Final Season Part 2' }) };
  };
  try {
    const request = { provider: 'tmdb', id: '95479', season: 4, episode: 29, isMovie: false };
    const title = await resolveSeasonFallbackTitle(request, 'test-key');
    assert.equal(title, 'The Final Season Part 2');

    // Season 1 can safely use the base series title.
    const seasonOne = await resolveSeasonFallbackTitle({ ...request, season: 1, episode: 5 }, 'test-key');
    assert.equal(seasonOne, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('local mapping rejects episodes beyond the Kitsu entry count', () => {
  const request = resolveMappingRequest('imdb:tt2560140:4:41');
  assert.ok(request);
  assert.equal(resolveLocalTarget(request), null, 'must fall through to live instead of playing a wrong episode');
});

test('local mapping resolves TMDB flattened seasons', () => {
  let target = targetFor('tmdb:95479:1:48');
  assert.equal(target.kitsuId, '48363');
  assert.equal(target.kitsuEpisode, 1);

  target = targetFor('tmdb:95479:1:60');
  assert.equal(target.kitsuId, '50627');
  assert.equal(target.kitsuEpisode, 1);

  target = targetFor('tmdb:207468:1:13');
  assert.equal(target.kitsuId, '48994');
  assert.equal(target.kitsuEpisode, 1);
});

test('local mapping resolves TVDB aired-order series', () => {
  let target = targetFor('tvdb:377543:3:13');
  assert.equal(target.kitsuId, '50627');
  assert.equal(target.kitsuEpisode, 1);

  target = targetFor('tvdb:267440:2:1');
  assert.equal(target.kitsuId, '8671');
  assert.equal(target.kitsuEpisode, 1);
});

test('un range con offset negativo non produce un episodio sbagliato', () => {
  const request = resolveMappingRequest('tmdb:81000', 1, 14, false);
  assert.ok(request);
  // Offset -1 ma l'episodio Kitsu calcolato (15) supera episodeCount (13):
  // qui il blocco arriva dal controllo di intervallo, non dall'offset.
  assert.equal(resolveLocalTarget(request), null, 'must fall through to live');
});

test('un passo nella numerazione (offset negativo) resta una mappatura valida', () => {
  // Beatless: l'episodio 6 del sito è il 7 sulla numerazione Kitsu, perché un
  // episodio è stato inserito prima. Prima questo andava al live per niente.
  const target = targetFor('tvdb:90001:1:6');
  assert.equal(target.kitsuId, '13939');
  assert.equal(target.kitsuEpisode, 7);
});

test('una special di stagione 0 che riusa il kitsuId della madre resta bloccata', () => {
  const request = resolveMappingRequest('tvdb:90002', 0, 1, false);
  assert.ok(request);
  assert.equal(resolveLocalTarget(request), null, 'range costruito male: meglio il live');
});

test('una special con kitsuId proprio non viene bloccata da un passo negativo', () => {
  // Princess Lover! Picture Drama: l'episodio 2 della stagione 0 è il 4 della
  // special, che è una entry Kitsu diversa dalla madre.
  const target = targetFor('tvdb:90003:0:2');
  assert.equal(target.kitsuId, '4987');
  assert.equal(target.kitsuEpisode, 4);
});

test('una special col titolo della madre non viene cercata', () => {
  // Cercare "Power Stone" episodio 1 restituirebbe la serie, non la special:
  // meglio lasciare la richiesta al live.
  const request = resolveMappingRequest('tmdb:80000', 0, 1, false);
  assert.ok(request);
  assert.equal(resolveLocalTarget(request), null);
});

test('un titolo italiano non latino non diventa una query', () => {
  // TMDB it-IT restituisce "ファントム THE ANIMATION": sui siti italiani è una
  // richiesta sprecata, quindi il target non lo porta.
  const target = targetFor('tvdb:83000:1:1');
  assert.equal(target.titleIt, '');
  assert.equal(target.title, 'Phantom: The Animation');
});

test('una special col titolo italiano della madre non viene cercata', () => {
  // Cowboy Bebop: il titolo TVDB è カウボーイビバップ, il range porta "Cowboy
  // Bebop". Confrontare solo col titolo giapponese lasciava passare la serie.
  const request = resolveMappingRequest('tvdb:76885', 0, 1, false);
  assert.ok(request);
  assert.equal(resolveLocalTarget(request), null);
});

test('il nome di una special è usabile come query solo se descrive qualcosa', async () => {
  const { isUsableSpecialTitle } = await import('../../dist/mapping/live.js');
  assert.equal(isUsableSpecialTitle('Mushroom Hunting'), true);
  assert.equal(isUsableSpecialTitle('よせあつめブルース'), false);
  assert.equal(isUsableSpecialTitle('ファントム THE ANIMATION'), false);
  assert.equal(isUsableSpecialTitle('Special 1'), false);
  assert.equal(isUsableSpecialTitle('OVA'), false);
  assert.equal(isUsableSpecialTitle('Season 0'), false);
  // Slug di produzione di TVDB: nessun sito italiano ha questo titolo.
  assert.equal(isUsableSpecialTitle('intermission_01'), false);
  assert.equal(isUsableSpecialTitle('What\'s BEATLESS'), true);
  assert.equal(isUsableSpecialTitle(''), false);
});

test('una special in stagione 0 non eredita il titolo italiano della madre', () => {
  const special = targetFor('tmdb:70000:0:1');
  // Il titolo della special, non quello della serie.
  assert.equal(special.title, 'Mezzo Forte Special');
  assert.equal(special.titleAlt, 'Mezzo Forte Special Romaji');
  // Il titolo italiano della madre farebbe cercare e filtrare la serie sbagliata.
  assert.equal(special.titleIt, '');
  assert.equal(special.kitsuEpisode, 1);
  assert.equal(special.displaySeason, 0);

  // Nella stagione normale l'italiano resta, perché lì la serie è quella giusta.
  const episode = targetFor('tmdb:70000:1:1');
  assert.equal(episode.titleIt, 'Mezzo Forte (IT)');
});

test('una entry mappata col solo TMDB risolve per titolo, senza kitsuId', () => {
  // Film: nessun episodio, il provider cerca per titolo.
  const movie = targetFor('tmdb:41000');
  assert.equal(movie.kitsuId, '');
  assert.equal(movie.kitsuEpisode, 1);
  assert.equal(movie.title, 'Masquerade');
  assert.equal(movie.titleIt, 'Masquerade');

  // Serie a stagione unica: offset 0, episodio passato così com'è.
  const series = targetFor('tmdb:70000:1:2');
  assert.equal(series.kitsuId, '');
  assert.equal(series.kitsuEpisode, 2);
  assert.equal(series.title, 'Mezzo Forte');
  assert.equal(series.displaySeason, 1);

  // Oltre episodeCount si scende al live, non si inventa un episodio.
  const beyond = resolveMappingRequest('tmdb:70000:1:3');
  assert.ok(beyond);
  assert.equal(resolveLocalTarget(beyond), null);
});

test('Kitsu is one entry per season and ignores the season segment', () => {
  let request = resolveMappingRequest('kitsu:8671:1');
  assert.ok(request);
  assert.equal(request.provider, 'kitsu');
  assert.equal(request.season, null);
  assert.equal(request.episode, 1);

  request = resolveMappingRequest('kitsu:8671:2:1');
  assert.ok(request);
  assert.equal(request.season, null);
  assert.equal(request.episode, 1);

  const target = resolveLocalTarget(request);
  assert.ok(target);
  assert.equal(target.kitsuId, '8671');
  assert.equal(target.kitsuEpisode, 1);
  assert.equal(target.displaySeason, null);
});

test('il titolo italiano arriva al provider anche per gli id Kitsu', () => {
  // Le richieste Kitsu non hanno chiavi esterne: il titolo italiano si legge
  // dalla mappa kitsuId costruita sull'indice. Il romaji resta fuori: per Kitsu
  // cambierebbe l'ordine dei ripieghi che oggi funzionano.
  let target = targetFor('kitsu:8671:2:1');
  assert.equal(target.titleIt, "L'attacco dei giganti");
  assert.equal(target.titleAlt, '');
  // La stagione viene dall'indice: l'id Kitsu non ne porta una.
  assert.equal(target.titleItSeason, 2);

  target = targetFor('tvdb:267440:2:1');
  assert.ok(target);
  assert.equal(target.kitsuId, '8671');
  assert.equal(target.titleIt, "L'attacco dei giganti");
});

test('movies resolve through TMDB and IMDb keys', () => {
  let target = targetFor('tmdb:372058');
  assert.equal(target.kitsuId, '11614');
  assert.equal(target.kitsuEpisode, 1);
  assert.equal(target.displaySeason, null);
  // Romaji MAL: serve ai provider per i siti che listano il titolo giapponese.
  assert.equal(target.titleAlt, 'Kimi no Na wa.');
  // Titolo italiano TMDB: è quello che listano Saturn e AnimeWorld.
  assert.equal(target.titleIt, 'Your Name. - Il tuo nome.');

  target = targetFor('tt5311514');
  assert.equal(target.kitsuId, '11614');
  assert.equal(target.titleAlt || '', '');
  assert.equal(target.titleIt, 'Your Name. - Il tuo nome.');
});

test('mapping signature changes when index or overrides content changes', () => {
  const before = getMappingVersion();

  const overridesFile = path.join(fixtureDir, 'overrides.json');
  fs.writeFileSync(overridesFile, JSON.stringify({
    series: { 'imdb:tt9999999': { title: 'Override', seasons: { '1': [{ from: 1, kitsuId: '1', offset: 0 }] } } },
    movies: {},
  }));
  process.env.ANIME_MAPPING_OVERRIDES = overridesFile;
  resetMappingCache();
  const afterOverrides = getMappingVersion();
  assert.notEqual(afterOverrides, before);
  assert.ok(targetFor('imdb:tt9999999:1:1'));

  const originalMtime = fs.statSync(overridesFile).mtimeMs;
  fs.writeFileSync(overridesFile, JSON.stringify({ series: {}, movies: { 'imdb:tt9999999': { kitsuId: '2', title: 'Movie' } } }));
  fs.utimesSync(overridesFile, new Date(originalMtime + 2000), new Date(originalMtime + 2000));
  resetMappingCache();
  assert.notEqual(getMappingVersion(), afterOverrides);

  delete process.env.ANIME_MAPPING_OVERRIDES;
  resetMappingCache();
});

test('parser handles TVDB and no S/E movies', () => {
  const series = parseRequestId('tvdb:377543:3:13');
  assert.ok(series);
  assert.equal(series.provider, 'tvdb');
  assert.equal(series.id, '377543');
  assert.equal(series.season, 3);
  assert.equal(series.episode, 13);
  assert.equal(series.isMovie, false);

  const movie = parseRequestId('tvdb:377543');
  assert.ok(movie);
  assert.equal(movie.isMovie, true);
  assert.equal(movie.season, null);
  assert.equal(movie.episode, null);

  assert.equal(toNumericId('tvdb:377543:3:13'), '377543');
});

test('live TVDB resolution aligns a Kitsu entry by air date (mocked fetch)', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TVDB_API_KEY;
  process.env.TVDB_API_KEY = 'test-tvdb-key';
  globalThis.fetch = async (input) => {
    const url = String(input);
    const json = (value) => ({ ok: true, json: async () => value });

    if (url.includes('/v4/login')) return json({ data: { token: 'token' } });
    if (url.includes('/v4/series/999001/episodes/default')) {
      return json({
        data: {
          episodes: [
            { seasonNumber: 2, number: 4, aired: '2020-01-04' },
            { seasonNumber: 2, number: 5, aired: '2020-01-11' },
          ],
        },
        links: { next: null },
      });
    }
    if (url.includes('/mappings?filter[externalSite]=thetvdb%2Fseries')) {
      return json({
        data: [{ relationships: { item: { data: { id: '50001' } } } }],
        included: [{
          type: 'anime',
          id: '50001',
          attributes: { canonicalTitle: 'Mock Anime', titles: { en: 'Mock Anime' }, startDate: '2020-01-11', subtype: 'TV' },
        }],
      });
    }
    if (url.includes('/anime/50001?include=mediaRelationships.destination')) {
      return json({
        data: {
          type: 'anime',
          id: '50001',
          attributes: { canonicalTitle: 'Mock Anime', titles: { en: 'Mock Anime' }, startDate: '2020-01-11', subtype: 'TV' },
        },
        included: [],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    const target = await resolveLiveTarget({
      provider: 'tvdb',
      id: '999001',
      season: 2,
      episode: 5,
      isMovie: false,
    });
    assert.ok(target);
    assert.equal(target.kitsuId, '50001');
    assert.equal(target.kitsuEpisode, 1);
    assert.equal(target.displaySeason, 2);
    assert.equal(target.source, 'live');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TVDB_API_KEY;
    else process.env.TVDB_API_KEY = originalKey;
  }
});

test('live TMDB flattened season maps to the correct TVDB aired episode (mocked fetch)', async () => {
  const originalFetch = globalThis.fetch;
  const originalTvdbKey = process.env.TVDB_API_KEY;
  process.env.TVDB_API_KEY = 'test-tvdb-key';
  globalThis.fetch = async (input) => {
    const url = String(input);
    const json = (value) => ({ ok: true, json: async () => value });

    if (url.includes('/v4/login')) return json({ data: { token: 'token' } });
    if (url.includes('/v4/series/999002/episodes/default')) {
      return json({
        data: {
          episodes: [
            { seasonNumber: 3, number: 1, aired: '2026-01-08' },
            { seasonNumber: 3, number: 2, aired: '2026-01-15' },
          ],
        },
        links: { next: null },
      });
    }
    if (url.includes('/tv/954799/external_ids')) return json({ tvdb_id: 999002 });
    if (url.includes('/tv/954799/season/1')) {
      return json({ episodes: [{ episode_number: 48, air_date: '2026-01-08' }] });
    }
    if (url.includes('/mappings?filter[externalSite]=thetvdb%2Fseries')) {
      return json({
        data: [{ relationships: { item: { data: { id: '70001' } } } }],
        included: [{
          type: 'anime',
          id: '70001',
          attributes: { canonicalTitle: 'Mock Franchise', titles: { en: 'Mock Franchise' }, startDate: '2020-01-01', subtype: 'TV', episodeCount: 24 },
        }],
      });
    }
    if (url.includes('/anime/70001?include=mediaRelationships.destination')) {
      return json({
        data: {
          type: 'anime',
          id: '70001',
          attributes: { canonicalTitle: 'Mock Franchise', titles: { en: 'Mock Franchise' }, startDate: '2020-01-01', subtype: 'TV', episodeCount: 24 },
        },
        included: [{
          type: 'mediaRelationships',
          id: '90001',
          attributes: { role: 'sequel' },
          relationships: { destination: { data: { id: '70002', type: 'anime' } } },
        }],
      });
    }
    if (url.includes('/anime/70002?include=mediaRelationships.destination')) {
      return json({
        data: {
          type: 'anime',
          id: '70002',
          attributes: { canonicalTitle: 'Mock Part 2', titles: { en: 'Mock Part 2' }, startDate: '2026-01-08', subtype: 'TV', episodeCount: 12 },
        },
        included: [],
      });
    }
    if (url.endsWith('/anime/70002')) {
      return json({
        data: {
          type: 'anime',
          id: '70002',
          attributes: { canonicalTitle: 'Mock Part 2', titles: { en: 'Mock Part 2' }, startDate: '2026-01-08', subtype: 'TV', episodeCount: 12 },
        },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    const target = await resolveLiveTarget({
      provider: 'tmdb',
      id: '954799',
      season: 1,
      episode: 48,
      isMovie: false,
    }, 'test-key');
    assert.ok(target);
    assert.equal(target.kitsuId, '70002');
    assert.equal(target.kitsuEpisode, 1);
    assert.equal(target.title, 'Mock Part 2');
    assert.equal(target.displaySeason, 1);
    assert.equal(target.source, 'live');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalTvdbKey === undefined) delete process.env.TVDB_API_KEY;
    else process.env.TVDB_API_KEY = originalTvdbKey;
  }
});

test('live movie mapping falls back to official TMDB title and Kitsu search (mocked fetch)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    const json = (value) => ({ ok: true, json: async () => value });

    if (url.includes('/mappings?filter[externalSite]=themoviedb%2Fmovie')) {
      return json({ data: [], included: [], links: { next: null } });
    }
    if (url.includes('/movie/555001/external_ids')) return json({});
    if (url.includes('/movie/555001?api_key=')) {
      return json({ id: 555001, title: 'Mock Anime Movie', release_date: '2024-05-01' });
    }
    if (url.includes('/anime?filter[text]=Mock%20Anime%20Movie')) {
      return json({
        data: [{
          type: 'anime',
          id: '81001',
          attributes: { canonicalTitle: 'Mock Anime Movie', titles: { en: 'Mock Anime Movie' }, startDate: '2024-05-01', subtype: 'movie' },
        }],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    const target = await resolveLiveTarget({
      provider: 'tmdb',
      id: '555001',
      season: null,
      episode: null,
      isMovie: true,
    }, 'test-key');
    assert.ok(target);
    assert.equal(target.kitsuId, '81001');
    assert.equal(target.kitsuEpisode, 1);
    assert.equal(target.title, 'Mock Anime Movie');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('per-request TVDB credentials are used without relying on process env (mocked fetch)', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TVDB_API_KEY;
  const originalPin = process.env.TVDB_PIN;
  delete process.env.TVDB_API_KEY;
  delete process.env.TVDB_PIN;
  let loginBody = '';

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const json = (value) => ({ ok: true, json: async () => value });
    if (url.includes('/v4/login')) {
      loginBody = String(init?.body || '');
      return json({ data: { token: 'request-token' } });
    }
    if (url.includes('/v4/series/999003/episodes/default')) {
      return json({
        data: { episodes: [{ seasonNumber: 1, number: 1, aired: '2020-01-04' }] },
        links: { next: null },
      });
    }
    if (url.includes('/mappings?filter[externalSite]=thetvdb%2Fseries')) {
      return json({
        data: [{ relationships: { item: { data: { id: '50003' } } } }],
        included: [{
          type: 'anime',
          id: '50003',
          attributes: { canonicalTitle: 'Request Key Anime', titles: { en: 'Request Key Anime' }, startDate: '2020-01-04', subtype: 'TV', episodeCount: 12 },
        }],
      });
    }
    if (url.includes('/anime/50003?include=mediaRelationships.destination')) {
      return json({
        data: {
          type: 'anime',
          id: '50003',
          attributes: { canonicalTitle: 'Request Key Anime', titles: { en: 'Request Key Anime' }, startDate: '2020-01-04', subtype: 'TV', episodeCount: 12 },
        },
        included: [],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    const target = await resolveLiveTarget({
      provider: 'tvdb',
      id: '999003',
      season: 1,
      episode: 1,
      isMovie: false,
    }, { tvdbApiKey: 'request-key', tvdbPin: '1234' });
    assert.ok(target);
    assert.equal(target.kitsuId, '50003');
    assert.ok(loginBody.includes('request-key'));
    assert.ok(loginBody.includes('1234'));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TVDB_API_KEY;
    else process.env.TVDB_API_KEY = originalKey;
    if (originalPin === undefined) delete process.env.TVDB_PIN;
    else process.env.TVDB_PIN = originalPin;
  }
});

test('no old mapping API references remain in src/config/scripts', () => {
  const forbidden = /anime\.stremio-italia|mapping_api|getMappingApiBase|fetchMappingPayload|extractProviderPaths|resolveLookupRequest|toTmdbNumericId|arm\.haglund\.dev|Haglund/;
  const roots = [
    path.resolve(__dirname, '..', '..', 'src'),
    path.resolve(__dirname, '..', '..', 'config'),
    path.resolve(__dirname, '..', '..', 'scripts'),
  ];
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|js|mjs|json|md)$/.test(entry.name) && forbidden.test(fs.readFileSync(full, 'utf8'))) {
        offenders.push(full);
      }
    }
  };
  for (const root of roots) if (fs.existsSync(root)) walk(root);
  assert.deepEqual(offenders, []);
});
