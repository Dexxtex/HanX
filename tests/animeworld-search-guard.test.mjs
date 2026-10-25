import assert from 'node:assert/strict';
import { test } from 'node:test';

// AnimeWorld restituisce il listone "ultimi arrivi" quando il filtro non ha
// corrispondenze: se viene preso per vero, il fallback produce stream di un
// altro anime (visto in produzione: Assassination Classroom -> Firefly Wedding).
const { awResultsRelateToQuery } = await import('../dist/providers/animeworld-provider.js');

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

test('query vuota non è mai considerata inerente', () => {
  assert.equal(awResultsRelateToQuery(REAL, ''), false);
});
