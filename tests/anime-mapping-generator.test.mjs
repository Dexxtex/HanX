import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alignEntries, alignTmdbEpisodes, pickKitsuResult, pickTmdbResult, rangesFrom, titleVariants, tmdbQuery, tvdbSeriesIdFromMappings, pickTvdbSeries, tvdbQueries, tvdbIdFromSearch } from '../scripts/build-anime-mapping.mjs';

const entry = (overrides = {}) => ({
  id: '100',
  title: 'Entry',
  startDate: '2020-01-01',
  subtype: 'TV',
  episodeCount: 12,
  ...overrides,
});

test('alignEntries handles double air dates without skipping episodes', () => {
  const entries = [entry()];
  const episodes = [
    { season: 1, number: 1, aired: '2020-01-05' },
    { season: 1, number: 2, aired: '2020-01-05' },
  ];
  const assignment = alignEntries(episodes, entries);
  assert.equal(assignment.size, 2);
  assert.equal(assignment.get('1:1').kitsuEpisode, 1);
  assert.equal(assignment.get('1:2').kitsuEpisode, 2);
  assert.equal(assignment.get('1:2').title, 'Entry');
});

test('alignEntries filters movie entries and respects episodeCount', () => {
  const entries = [
    entry({ id: '200', subtype: 'movie', startDate: '2020-01-01' }),
    entry({ id: '100', episodeCount: 1 }),
  ];
  const assignment = alignEntries([
    { season: 1, number: 1, aired: '2020-01-05' },
    { season: 1, number: 2, aired: '2020-01-12' },
  ], entries);
  assert.equal(assignment.size, 1);
  assert.equal(assignment.get('1:1').kitsuId, '100');
});

test('alignTmdbEpisodes matches one-to-one on double air dates', () => {
  const assignments = [
    { episode: { season: 1, number: 1, aired: '2020-01-05' }, kitsuId: '100', kitsuEpisode: 1, title: 'A', episodeCount: 12 },
    { episode: { season: 1, number: 2, aired: '2020-01-05' }, kitsuId: '100', kitsuEpisode: 2, title: 'A', episodeCount: 12 },
  ];
  const tmdb = [
    { season: 1, number: 1, aired: '2020-01-05' },
    { season: 1, number: 2, aired: '2020-01-05' },
  ];
  const matched = alignTmdbEpisodes(assignments, tmdb);
  assert.equal(matched.length, 2);
  assert.deepEqual(new Set(matched.map((item) => `${item.season}:${item.episode}`)), new Set(['1:1', '1:2']));

  // A single TMDB episode must not be reused for two TVDB episodes.
  const once = alignTmdbEpisodes(assignments, [tmdb[0]]);
  assert.equal(once.length, 1);
});

test('alignEntries advances to the sequel when the current cour is exhausted', () => {
  const entries = [
    entry({ id: '100', title: 'Part 1', startDate: '2020-01-01', episodeCount: 2 }),
    entry({ id: '200', title: 'Part 2', startDate: '2020-01-15', episodeCount: 2 }),
  ];
  const assignment = alignEntries([
    { season: 1, number: 1, aired: '2020-01-01' },
    { season: 1, number: 2, aired: '2020-01-08' },
    { season: 1, number: 3, aired: '2020-01-15' },
    { season: 1, number: 4, aired: '2020-01-22' },
  ], entries);
  assert.equal(assignment.get('1:1').kitsuId, '100');
  assert.equal(assignment.get('1:2').kitsuId, '100');
  assert.equal(assignment.get('1:3').kitsuId, '200');
  assert.equal(assignment.get('1:3').kitsuEpisode, 1);
  assert.equal(assignment.get('1:4').kitsuId, '200');
  assert.equal(assignment.get('1:4').kitsuEpisode, 2);
  const seasons = rangesFrom([...assignment.values()].map(({ episode, kitsuId, kitsuEpisode, title, episodeCount }) => ({
    season: episode.season,
    episode: episode.number,
    kitsuId,
    kitsuEpisode,
    title,
    episodeCount,
  })));
  assert.equal(seasons['1'][1].from, 3);
  assert.equal(seasons['1'][1].kitsuId, '200');
});

test('rangesFrom dedups duplicate from values and keeps titles/episodeCount', () => {
  const seasons = rangesFrom([
    { season: 1, episode: 1, kitsuId: '100', kitsuEpisode: 1, title: 'A', episodeCount: 12 },
    { season: 1, episode: 1, kitsuId: '200', kitsuEpisode: 1, title: 'B', episodeCount: 12 },
    { season: 1, episode: 2, kitsuId: '200', kitsuEpisode: 1, title: 'B', episodeCount: 12 },
  ]);
  const ranges = seasons['1'];
  assert.deepEqual(ranges.map((range) => range.from), [1, 2]);
  assert.equal(ranges[0].title, 'A');
  assert.equal(ranges[1].title, 'B');
  assert.equal(ranges[1].episodeCount, 12);
});

test('tmdbQuery prefers the English title and the MAL start year', () => {
  assert.deepEqual(
    tmdbQuery({ type: 'TV', title: 'Shingeki no Kyojin', title_english: 'Attack on Titan', aired: { from: '2013-04-07T00:00:00+00:00' } }),
    { kind: 'tv', queries: ['Attack on Titan', 'Shingeki no Kyojin'], year: 2013 },
  );
  assert.deepEqual(tmdbQuery({ type: 'Movie', title: 'Sen to Chihiro no Kamikakushi' }), {
    kind: 'movie',
    queries: ['Sen to Chihiro no Kamikakushi'],
    year: null,
  });
});

test('titleVariants riduce i seguiti al titolo della serie madre', () => {  // TMDB non ha "City Hunter 2": la serie è una stagione di "City Hunter".
  assert.ok(titleVariants('City Hunter 2', true).includes('City Hunter'));
  assert.ok(titleVariants('Major S2', true).includes('Major'));
  assert.ok(titleVariants('Uchuu Senkan Yamato III', true).includes('Uchuu Senkan Yamato'));
  assert.ok(titleVariants('Seikai no Senki II', true).includes('Seikai no Senki'));
  // Il titolo intero resta sempre il primo tentativo.
  assert.equal(titleVariants('City Hunter 2', true)[0], 'City Hunter 2');
  // Per i film la coda numerica è un altro film: nessuna riduzione.
  assert.deepEqual(titleVariants('Kizumonogatari II'), ['Kizumonogatari II']);
});

test('pickTmdbResult scarta remake live-action e anni sbagliati', () => {
  const results = [
    { id: 100, original_language: 'en', name: 'Cowboy Bebop', first_air_date: '2021-11-19' },
    { id: 200, original_language: 'ja', name: 'Cowboy Bebop', first_air_date: '1998-04-03' },
  ];
  assert.equal(pickTmdbResult(results, 1998)?.id, 200);
  // Solo il remake: nessun match, meglio un buco che un episodio sbagliato.
  assert.equal(pickTmdbResult([results[0]], 1998), null);
  // Senza anno si prende il primo giapponese.
  assert.equal(pickTmdbResult(results, null)?.id, 200);
});
test('pickKitsuResult accetta solo un candidato unico e coerente', () => {
  const result = (id, title, startDate, subtype = 'TV') => ({
    id,
    attributes: { canonicalTitle: title, startDate, subtype, titles: {} },
  });
  const wanted = { titles: ['Bakugan: Battle Planet'], year: 2019, subtype: 'tv' };

  // Titolo esatto + anno vicino: match.
  assert.equal(pickKitsuResult([result('42166', 'Bakugan: Battle Planet', '2018-12-23')], wanted)?.id, '42166');
  // Anno lontano: scartato.
  assert.equal(pickKitsuResult([result('1', 'Bakugan: Battle Planet', '2003-01-01')], wanted), null);
  // Due candidati identici: ambiguo, meglio nessuno.
  assert.equal(pickKitsuResult([
    result('1', 'Bakugan: Battle Planet', '2019-01-01'),
    result('2', 'Bakugan: Battle Planet', '2019-06-01'),
  ], wanted), null);
  // Sottotipo diverso: scartato.
  assert.equal(pickKitsuResult([result('3', 'Bakugan: Battle Planet', '2019-01-01', 'movie')], wanted), null);
});
test('tmdbQuery prova anche il titolo base delle stagioni MAL', () => {
  const { queries, year } = tmdbQuery({
    type: 'TV',
    title: 'Rozen Maiden: Träumend',
    title_english: 'Rozen Maiden: Träumend',
    aired: { from: '2005-10-20' },
  });
  assert.deepEqual(queries, ['Rozen Maiden: Träumend', 'Rozen Maiden']);
  assert.equal(year, 2005);

  // Niente base quando il separatore lascia troppo poco o è parte del nome.
  assert.deepEqual(tmdbQuery({ type: 'TV', title: 'Re:Zero kara Hajimeru Isekai Seikatsu' }).queries, [
    'Re:Zero kara Hajimeru Isekai Seikatsu',
    'Re',
  ].filter((q) => q !== 'Re'));
});
test('titleVariants copre i suffissi MAL che TMDB non usa', () => {
  assert.deepEqual(titleVariants('Area 88 (TV)'), ['Area 88 (TV)', 'Area 88']);
  assert.deepEqual(titleVariants('Rozen Maiden: Träumend'), ['Rozen Maiden: Träumend', 'Rozen Maiden']);
  assert.deepEqual(titleVariants('Yowamushi Pedal 2nd Season'), ['Yowamushi Pedal 2nd Season', 'Yowamushi Pedal']);
  // Niente varianti suicide: un titolo senza suffissi resta se stesso.
  assert.deepEqual(titleVariants('One Piece'), ['One Piece']);
});

test('tmdbQuery mette il titolo originale davanti alle varianti', () => {
  const { queries } = tmdbQuery({ type: 'TV', title: 'Area 88 (TV)', aired: { from: '2004-01-09' } });
  assert.deepEqual(queries, ['Area 88 (TV)', 'Area 88']);
});

test('tvdbSeriesIdFromMappings prende la serie TVDB e ignora la stagione', () => {
  const data = [
    { attributes: { externalSite: 'myanimelist/anime', externalId: '1471' } },
    { attributes: { externalSite: 'thetvdb/season', externalId: '28049' } },
    { attributes: { externalSite: 'thetvdb/series', externalId: '72877' } },
  ];
  assert.equal(tvdbSeriesIdFromMappings(data), '72877');
  assert.equal(tvdbSeriesIdFromMappings([]), null);
  assert.equal(tvdbSeriesIdFromMappings(undefined), null);
});
test('pickTvdbSeries accetta il titolo giapponese e vuole anno ±1', () => {
  const wanted = tvdbQueries({ title: 'Patalliro Saiyuuki!', title_japanese: 'パタリロ西遊記!', aired: { from: '2005-04-10' } });
  const found = pickTvdbSeries([{ objectID: '83637', name: 'パタリロ西遊記!', year: '2005' }], wanted);
  assert.equal(found.objectID, '83637');

  // Anno sbagliato: nessun match, anche col titolo identico.
  assert.equal(pickTvdbSeries([{ objectID: '1', name: 'パタリロ西遊記!', year: '1990' }], wanted), null);
  // Due candidati plausibili: ambiguo, si scarta.
  assert.equal(
    pickTvdbSeries(
      [
        { objectID: '1', name: 'パタリロ西遊記!', year: '2005' },
        { objectID: '2', name: 'パタリロ西遊記!', year: '2006' },
      ],
      wanted,
    ),
    null,
  );
  // Titolo diverso: mai.
  assert.equal(pickTvdbSeries([{ objectID: '3', name: 'Altro', year: '2005' }], wanted), null);

  // TVDB senza anno: titolo identico e candidato unico, si accetta.
  const piroppo = tvdbQueries({ title: 'Piroppo', title_japanese: 'ピロッポ', aired: { from: '2001-04-04' } });
  assert.equal(pickTvdbSeries([{ objectID: '9', name: 'ピロッポ', year: undefined }], piroppo)?.objectID, '9');

  // Serie accorpata nella madre: il seguito è una stagione, l'anno è quello della prima.
  const wataru = tvdbQueries({ title: 'Chou Mashin Eiyuuden Wataru', title_japanese: '超魔神英雄伝ワタル', aired: { from: '1997-10-02' } });
  assert.equal(pickTvdbSeries([{ objectID: '77', name: '魔神英雄伝ワタル', year: '1988' }], wataru)?.objectID, '77');
});

test('tvdbIdFromSearch toglie il prefisso "series-"', () => {
  assert.equal(tvdbIdFromSearch({ objectID: 'series-227501' }), '227501');
  assert.equal(tvdbIdFromSearch({ objectID: '435404' }), '435404');
  assert.equal(tvdbIdFromSearch({ id: 1234 }), '1234');
  assert.equal(tvdbIdFromSearch({}), null);
});

test('pickTvdbSeries confronta anche i titoli cinesi', () => {
  const cinese = tvdbQueries({ title: 'Shen Diao Xia Lu II', title_japanese: '神雕侠侣II：襄阳风云', aired: { from: '2006-01-01' } });
  // Due punti a larghezza piena nel titolo, normalizzati da NFKC.
  const found = pickTvdbSeries([{ objectID: 'series-1', name: '神雕侠侣II: 襄阳风云', year: '2006' }], cinese);
  assert.equal(found?.objectID, 'series-1');
});