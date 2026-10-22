import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  animeSlugBase,
  buildTitleFallbackQueries,
  normalizeSearchTitleKey,
  normalizeTitleForSearch,
  resolveExactMapKey,
} from '../dist/utils/anime-title-normalization.js';

const animeWorldConfig = {
  exactMap: {
    'Attack on Titan: Final Season': 'Attack on Titan: The Final Season',
    'My Hero Academia Final Season': 'Boku no Hero Academia: Final Season',
  },
  replacements: [
    ['Attack on Titan', "L'attacco dei Giganti"],
    ['Season', ''],
    ['Shippuuden', 'Shippuden'],
    ['Solo Leveling 2', 'Solo Leveling 2:'],
    ['Solo Leveling 2 :', 'Solo Leveling 2:'],
    ['-', ''],
  ],
  stripColonAfter: 'Naruto:',
};

test('exactMap ha precedenza sui replacement', () => {
  assert.equal(
    normalizeTitleForSearch('Attack on Titan: Final Season', animeWorldConfig),
    'Attack on Titan: The Final Season'
  );
  assert.equal(
    normalizeTitleForSearch('My Hero Academia Final Season', animeWorldConfig),
    'Boku no Hero Academia: Final Season'
  );
  assert.equal(
    normalizeTitleForSearch('ignored', animeWorldConfig, 'Attack on Titan: Final Season'),
    'Attack on Titan: The Final Season'
  );
});

test('resolveExactMapKey cerca prima il titolo originale e poi quello universale', () => {
  const exactMap = { Original: 'A', Universal: 'B' };
  assert.equal(resolveExactMapKey('Original', 'Universal', exactMap), 'Original');
  assert.equal(resolveExactMapKey('Missing', 'Universal', exactMap), 'Universal');
  assert.equal(resolveExactMapKey('Missing', 'Missing', exactMap), null);
});

test('i replacement AnimeWorld restano nell’ordine storico', () => {
  assert.equal(
    normalizeTitleForSearch('Attack on Titan Season 2', animeWorldConfig),
    "L'attacco dei Giganti 2"
  );
  assert.equal(
    normalizeTitleForSearch('Naruto: Shippuuden', animeWorldConfig),
    'Naruto Shippuden'
  );
  assert.equal(
    normalizeTitleForSearch('Solo Leveling 2', animeWorldConfig),
    'Solo Leveling 2:'
  );
  assert.equal(
    normalizeTitleForSearch('Title - Sub', animeWorldConfig),
    'Title Sub'
  );
});

test('normalizeSearchTitleKey ignora marcatori di versione e punteggiatura', () => {
  assert.equal(
    normalizeSearchTitleKey('That Time I Got Reincarnated as a Slime 2 Part 2 (ITA)'),
    'that time i got reincarnated as a slime 2 part 2'
  );
  assert.equal(normalizeSearchTitleKey('[Oshi no Ko] (CR)'), 'oshi no ko');
  assert.equal(normalizeSearchTitleKey('Title (SUB ITA)'), 'title');
});

test('animeSlugBase toglie id dopo il punto e suffisso lingua', () => {
  assert.equal(animeSlugBase('death-note-12345.abc'), 'death-note-12345');
  assert.equal(animeSlugBase('death-note-ita.123'), 'death-note');
  assert.equal(animeSlugBase('death-note-sub-ita.123'), 'death-note');
  assert.equal(animeSlugBase('death-note-cr-ita'), 'death-note');
  assert.equal(animeSlugBase('death-note-ita-cr'), 'death-note');
});

test('modalità literal mantiene il comportamento AnimeSaturn', () => {
  const config = {
    exactMap: { 'Fullmetal Alchemist: Brotherhood': 'Fullmetal Alchemist Brotherhood' },
    replacements: [
      ['Attack on Titan', "L'attacco dei Giganti"],
      ['Season', ''],
      ['Shippuuden', 'Shippuden'],
    ],
    replacementMode: 'literal',
    stripSpacedHyphen: true,
    stripColonAfter: 'Naruto:',
  };
  assert.equal(
    normalizeTitleForSearch('Fullmetal Alchemist: Brotherhood', config),
    'Fullmetal Alchemist Brotherhood'
  );
  assert.equal(
    normalizeTitleForSearch('Attack on Titan Season 2', config),
    "L'attacco dei Giganti 2"
  );
  assert.equal(normalizeTitleForSearch('Naruto: Shippuuden', config), 'Naruto Shippuden');
  assert.equal(normalizeTitleForSearch('Title - Sub', config), 'Title Sub');
  assert.equal(
    normalizeTitleForSearch('Season 2 Season 3', { exactMap: {}, replacements: [['Season', '']], replacementMode: 'literal' }),
    '2 Season 3'
  );
});

test('buildTitleFallbackQueries conserva ordine e varianti', () => {
  assert.deepEqual(
    buildTitleFallbackQueries("L'attacco dei Giganti (ITA) Parte 2"),
    [
      'Lattacco dei Giganti (ITA) Parte 2',
      "L'attacco dei Giganti",
      "L'attacco dei Giganti",
      'L\'attacco+dei+Giganti+(ITA)+Parte+2',
    ]
  );
  assert.deepEqual(buildTitleFallbackQueries('Death Note'), ['Death+Note']);
});
