import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  animeSlugBase,
  buildTitleFallbackQueries,
  normalizeSearchTitleKey,
  normalizeTitleForSearch,
  resolveExactMapKey,
  titleMatchScore,
  titleMatchScoreAny,
} from '../../dist/utils/anime-title-normalization.js';

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

test('i simboli decorativi non finiscono nella query', () => {
  // Caso reale: "Fuuun Ishin Dai☆Shougun" con la stella dà 0 risultati su
  // Saturn e World; la scheda è "Fuuun Ishin Dai Shogun".
  const config = { exactMap: {}, replacements: [] };
  assert.equal(normalizeTitleForSearch('Fuuun Ishin Dai☆Shougun', config), 'Fuuun Ishin Dai Shougun');
  assert.equal(normalizeTitleForSearch('Yu☆Gi☆Oh! Arc-V', config), 'Yu Gi Oh! Arc-V');
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

test('buildTitleFallbackQueries prova la metà italiana dei titoli ibridi', () => {
  // "Hungry Heart: Wild Striker - La squadra del cuore": su AnimeSaturn la
  // scheda si chiama "La squadra del cuore".
  assert.ok(
    buildTitleFallbackQueries('Hungry Heart: Wild Striker - La squadra del cuore').includes('La squadra del cuore')
  );
});

test('buildTitleFallbackQueries prova la coda dei titoli "franchise: sottotitolo"', () => {
  // Saturn restituisce al massimo 10 schede: "Mobile Suit Gundam" riporta il
  // franchise (il film non c'è), "Flights of Fancy" riporta la scheda esatta.
  assert.equal(buildTitleFallbackQueries('Ah! My Goddess: Flights of Fancy')[0], 'Flights of Fancy');
  assert.ok(
    buildTitleFallbackQueries('Mobile Suit Gundam: Il contrattacco di Char').includes('Il contrattacco di Char')
  );
  // Una coda fatta solo di articolo e formato non è una query.
  const movie = buildTitleFallbackQueries('Ah! My Goddess: The Movie');
  assert.ok(!movie.includes('The Movie'));
  assert.equal(movie[0], 'Ah! My Goddess');
});

test('buildTitleFallbackQueries converte il numero romano in cifre', () => {
  // Su Saturn e AnimeUnity la serie è "Cyberpunk: Edgerunners 2", non "II".
  assert.deepEqual(
    buildTitleFallbackQueries('CYBERPUNK: EDGERUNNERS II'),
    // La coda a cifre viene per prima: "EDGERUNNERS 2" rientra nei 10 risultati
    // che il sito restituisce, il titolo intero no.
    ['EDGERUNNERS 2', 'CYBERPUNK: EDGERUNNERS 2', 'CYBERPUNK:+EDGERUNNERS+II']
  );
  // Nessun numero romano in coda: la lista resta quella di sempre.
  assert.deepEqual(buildTitleFallbackQueries('Death Note'), ['Death+Note']);
});

test('gli ordinali inglesi diventano cifre, come sui siti', () => {
  // Caso reale: "Space Dandy 2nd Season" cercato su AnimeSaturn/AnimeWorld dava
  // 0 risultati, mentre il sito ha "space-dandy-2".
  assert.equal(
    normalizeTitleForSearch('Space Dandy 2nd Season', { exactMap: {}, replacements: [['Season', '']] }),
    'Space Dandy 2'
  );
  assert.equal(
    normalizeTitleForSearch('Space Dandy 2nd', { exactMap: {}, replacements: [] }),
    'Space Dandy 2'
  );
  // Ordinale in testa: non è una stagione, resta com'è.
  assert.equal(
    normalizeTitleForSearch('1st Love', { exactMap: {}, replacements: [] }),
    '1st Love'
  );
  // Il filtro tratta "2nd" e "2" come lo stesso titolo.
  assert.equal(titleMatchScore('Space Dandy 2nd', 'Space Dandy 2'), 1);
  // E la query di ripiego proposta è la cifra.
  assert.ok(buildTitleFallbackQueries('Space Dandy 2nd').includes('Space Dandy 2'));
});

test('titleMatchScore considera "II" e "2" la stessa stagione', () => {
  assert.equal(
    titleMatchScore('CYBERPUNK: EDGERUNNERS II', 'Cyberpunk: Edgerunners 2'),
    1
  );
  assert.equal(titleMatchScore('Mob Psycho 100 III', 'Mob Psycho 100 3'), 1);
  // La serie base continua a non valere come stagione 2.
  assert.equal(titleMatchScore('Cyberpunk: Edgerunners', 'Cyberpunk: Edgerunners 2'), 0);
});

test('titleMatchScoreAny recupera il romaji MAL quando l’inglese non matcha', () => {
  const english = 'Haikyu!! Movie: The Dumpster Battle';
  const romaji = 'Haikyuu!! Movie: Gomisuteba no Kessen';
  const siteTitle = 'Haikyuu!! Movie: Gomisuteba no Kessen';

  // Senza romaji il filtro dei provider scarta il risultato giusto.
  assert.equal(titleMatchScore(english, siteTitle), 0);
  assert.equal(titleMatchScoreAny([english], siteTitle), 0);
  // Col romaji MAL il match è esatto.
  assert.equal(titleMatchScoreAny([english, romaji], siteTitle), 1);
  // Titolo non correlato resta a zero anche con l'alternativo.
  assert.equal(titleMatchScoreAny([english, romaji], 'One Piece'), 0);
});

test('un sottotitolo nuovo non è un match 0.9 (Prince of Tennis)', () => {
  // La scheda "Final Member Selection Match" è l'anime del 2026, non la
  // stagione 1 del 2022: il prefisso in comune non basta.
  assert.equal(
    titleMatchScore(
      'The Prince of Tennis II: U-17 WORLD CUP',
      'The Prince of Tennis II U-17 WORLD CUP: Final Member Selection Match'
    ),
    0
  );
});

test('gli omoglifi cirillici di Kitsu non rompono ricerca e match', () => {
  // Dato reale di Kitsu 50991: "Jyuоu" con la о cirillica (U+043E).
  const dirty = 'Jyu\u043Eu Mujin Dandivine';
  assert.equal(
    normalizeTitleForSearch(dirty, { exactMap: {}, replacements: [] }),
    'Jyuou Mujin Dandivine'
  );
  assert.equal(titleMatchScore(dirty, 'Jyuou Mujin Dandivine'), 1);
  assert.equal(normalizeSearchTitleKey(dirty), 'jyuou mujin dandivine');
});

test('il trattino tolto dalla query non fa perdere il risultato (Kurumi-chan)', () => {
  // AnimeUnity cerca "FX Fighter Kurumichan", la scheda del sito è
  // "FX Fighter Kurumi-chan": stessi token, cambia solo il trattino.
  assert.equal(titleMatchScore('FX Fighter Kurumichan', 'FX Fighter Kurumi-chan'), 1);
});
