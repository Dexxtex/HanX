import assert from 'node:assert/strict';
import { test } from 'node:test';

const { pickBestScored } = await import('../../dist/providers/anime-core/helpers.js');
const { REVIEW_SCORE } = await import('../../dist/catalog/matcher.js');

// Regola unica per Saturn e Unity: tiene solo il punteggio migliore, e niente
// sotto soglia. Prima era copiata in due provider con lo `0.5` scritto a mano.
test('pickBestScored: tiene solo il migliore, sopra soglia', () => {
  const scored = [
    { result: 'a', score: 1 },
    { result: 'b', score: 0.9 },
    { result: 'c', score: 1 },
  ];
  assert.deepEqual(pickBestScored(scored, REVIEW_SCORE), ['a', 'c']);
});

test('pickBestScored: sotto soglia non passa niente', () => {
  assert.deepEqual(pickBestScored([{ result: 'a', score: 0.49 }], REVIEW_SCORE), []);
});

test('pickBestScored: lista vuota', () => {
  assert.deepEqual(pickBestScored([], REVIEW_SCORE), []);
});

test('la soglia è quella del matcher, non un 0.5 locale', () => {
  assert.equal(REVIEW_SCORE, 0.5);
  // Un punteggio esattamente sulla soglia passa: il confronto è >=.
  assert.deepEqual(pickBestScored([{ result: 'a', score: REVIEW_SCORE }], REVIEW_SCORE), ['a']);
});
