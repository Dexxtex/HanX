import assert from 'node:assert/strict';
import { test } from 'node:test';

const { animeWorldDisplayName, animeWorldStreamName, awResultsRelateToQuery, filterWorldVersionsByQuery } = await import('../../dist/providers/animeworld-provider.js');

// AnimeWorld restituisce il listone "ultimi arrivi" quando il filtro non ha
// corrispondenze: se viene preso per vero, il fallback produce stream di un
// altro anime (visto in produzione: Assassination Classroom -> Firefly Wedding).
const JUNK = [
  { slug: 'firefly-wedding.ul7Gm', name: 'Firefly Wedding', searchTitle: 'Firefly Wedding' },
  { slug: 'one-piece-ita.d5nahE', name: 'One Piece (ITA)', searchTitle: 'One Piece (ITA)' },
  { slug: 'black-clover-ita.IDsmb', name: 'black-clover-ita.IDsmb' },
];

const REAL = [
  { slug: 'assassination-classroom.6zCvL', name: 'Assassination Classroom', searchTitle: 'Assassination Classroom' },
  { slug: 'assassination-classroom-ita.XYmPy', name: 'Assassination Classroom (ITA)', searchTitle: 'Assassination Classroom (ITA)' },
];

test('listone generico del sito: nessun risultato inerente alla query', () => {
  assert.equal(awResultsRelateToQuery(JUNK, "Assassination Classroom: Everyone's Time"), false);
  assert.equal(awResultsRelateToQuery(JUNK, 'Naruto'), false);
});

test('risultati reali: la query trova la corrispondenza', () => {
  assert.equal(awResultsRelateToQuery(REAL, "Assassination Classroom: Everyone's Time"), true);
  assert.equal(awResultsRelateToQuery(REAL, 'Assassination Classroom'), true);
  assert.equal(awResultsRelateToQuery(REAL, 'accassination'), false);
});

test('titoli con soli token brevi non vengono scartati', () => {
  assert.equal(awResultsRelateToQuery([{ slug: 'k-on.abc', name: 'K-On' }], 'K-On'), true);
});

test('etichetta: usa il titolo della scheda, non il badge di tipo', () => {
  // La scheda "poster" porta solo il tipo ("ONA") e vince su quella col titolo.
  assert.equal(animeWorldStreamName({ name: 'ONA', searchTitle: 'Umayuru' }, 'umayuru.OVrK6'), 'Umayuru');
  assert.equal(animeWorldStreamName({ name: 'Umayuru', searchTitle: 'Umayuru' }, 'umayuru.OVrK6'), 'Umayuru');
  // Se la scheda col titolo non e' stata trovata, il badge non deve finire nell'etichetta.
  assert.equal(animeWorldStreamName({ name: 'ONA' }, 'umayuru.OVrK6'), 'Umayuru');
  // La parola "film" dentro un titolo vero resta.
  assert.equal(animeWorldStreamName({ name: 'Naruto - Il film' }, 'naruto-movie.abc'), 'Naruto - Il film');
});

test('query vuota non è mai considerata inerente', () => {
  assert.equal(awResultsRelateToQuery(REAL, ''), false);
});

test('uno slug con id e marcatore di lingua non diventa un titolo', () => {
  // Caso visto in produzione: la scheda ITA arriva col nome che è lo slug nudo.
  assert.equal(
    animeWorldDisplayName('tokyo-revengers-war-of-the-three-titan-arc-ita.QrTnb', 'tokyo-revengers-war-of-the-three-titan-arc-ita.QrTnb'),
    'tokyo revengers war of the three titan arc'
  );
  assert.equal(
    animeWorldDisplayName('', 'black-clover-ita.IDsmb'),
    'black clover'
  );
});

test('i titoli veri restano com sono, con la lingua tolta', () => {
  assert.equal(
    animeWorldDisplayName('Tokyo Revengers: War of the Three Titan Arc (ITA)', 'tokyo-revengers-war-of-the-three-titan-arc-ita.QrTnb'),
    'Tokyo Revengers: War of the Three Titan Arc'
  );
  assert.equal(animeWorldDisplayName('DUB', 'cyberpunk-edgerunners-2.O8RTe'), 'cyberpunk edgerunners 2');
});

test('il listone generico viene filtrato voce per voce, non solo accettato o scartato', () => {
  // Caso in produzione: "La malinconia di Haruhi Suzumiya 2" -> 18 risultati, uno
  // solo inerente. awResultsRelateToQuery diceva "la lista va bene" e si aprivano
  // tutte le 18 pagine (150-500 KB l'una) fino al timeout di 30 s.
  const haruhi = [
    ...JUNK,
    { slug: 'suzumiya-haruhi-no-yuuutsu-2.5iDCR', name: 'suzumiya-haruhi-no-yuuutsu-2.5iDCR' },
    { slug: 'cyberpunk-edgerunners-2.O8RTe', name: 'cyberpunk-edgerunners-2.O8RTe' },
  ];
  assert.equal(awResultsRelateToQuery(haruhi, 'La malinconia di Haruhi Suzumiya 2'), true);
  const kept = filterWorldVersionsByQuery(haruhi, 'La malinconia di Haruhi Suzumiya 2');
  assert.deepEqual(kept.map(v => v.slug), ['suzumiya-haruhi-no-yuuutsu-2.5iDCR']);
});

test('il filtro tiene il titolo mostrato quando lo slug e in un altra lingua', () => {
  const kept = filterWorldVersionsByQuery(REAL, 'Assassination Classroom');
  assert.equal(kept.length, 2);
});

test('query senza parole utili non filtra nulla', () => {
  assert.equal(filterWorldVersionsByQuery(JUNK, 'a b').length, JUNK.length);
});
