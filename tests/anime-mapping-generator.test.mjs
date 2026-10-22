import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alignEntries, alignTmdbEpisodes, rangesFrom } from '../scripts/build-anime-mapping.mjs';

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
