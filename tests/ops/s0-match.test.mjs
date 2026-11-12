import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classificaS0 } from '../../scripts/ops/s0-match.mjs';

/** Scheda finta con `n` episodi in S0, tutti con lo stesso nome generico. */
function scheda(n, { title = 'Zeta Quest', episodes = 1, year = 2012, air = '2012-01-01' } = {}) {
  const eps = Array.from({ length: n }, (_, i) => ({ n: i + 1, name: `Episodio ${i + 1}`, air }));
  return {
    title,
    titles: [],
    episodes,
    year,
    startDate: air,
    tmdbTitle: 'Zeta Quest',
    s0: { eng: eps, ita: [], jpn: [] },
  };
}

test('ancora interna: il range non si inventa un inizio', () => {
  // Ancora su S0E3, scheda da 7 episodi: `3 - 7 + 1 = -3`. La versione
  // precedente faceva `Math.max(1, ...)` e proponeva 1-7, che e' una seconda
  // assunzione ("il blocco parte da S0E1") non sostenuta da niente.
  const c = scheda(34, { episodes: 7, air: '2012-01-01' });
  c.s0.eng[2].name = 'Zeta Quest'; // l'ancora e' S0E3
  const e = classificaS0(c, { episodes: 7, type: 'Special' });
  assert.equal(e.anchorEpisode, 3);
  assert.equal(e.from, null, 'nessun from arbitrario');
  assert.equal(e.rangeDetermined, false);
  assert.equal(e.rangeVerified, false);
  assert.equal(e.proposalReason, 'ambiguous');
  // Le posizioni possibili sono 3 (ancora 1a, 2a o 3a), tutte dentro S0.
  assert.deepEqual(e.alternativeRanges.map((r) => r.from), [3, 2, 1]);
});

test('un solo range valido: determinato per esclusione', () => {
  // Scheda da 3, ancora su S0E2, S0 lunga 3: solo from=1 sta dentro (1-3).
  const c = scheda(3, { episodes: 3 });
  c.s0.eng[1].name = 'Zeta Quest';
  const e = classificaS0(c, { episodes: 3, type: 'OVA' });
  assert.equal(e.anchorEpisode, 2);
  assert.equal(e.from, 1);
  assert.equal(e.alternativeRanges.length, 1);
  assert.equal(e.rangeDetermined, true);
  assert.equal(e.proposalReason, 'only_valid_range');
});

test('nessun range valido: non si propone niente', () => {
  // Scheda da 7 su una S0 di 5: qualunque posizione sfora la stagione.
  const c = scheda(5, { episodes: 7 });
  c.s0.eng[2].name = 'Zeta Quest';
  const e = classificaS0(c, { episodes: 7, type: 'Special' });
  assert.equal(e.from, null);
  assert.equal(e.alternativeRanges.length, 0);
  assert.equal(e.proposalReason, 'no_valid_range');
});

test('scheda di un episodio: il range e\' quell\'episodio', () => {
  const c = scheda(12, { episodes: 1 });
  c.s0.eng[5].name = 'Zeta Quest';
  const e = classificaS0(c, { episodes: 1, type: 'OVA' });
  assert.equal(e.from, 6);
  assert.equal(e.episodeCount, 1);
  assert.equal(e.rangeDetermined, true);
  assert.equal(e.proposalReason, 'single_episode');
});

test('date coerenti su un solo range: quello, ma non determinato', () => {
  // Freezing: ancora S0E6, scheda 6, S0 12. I primi 6 episodi sono del 2011,
  // gli altri del 2013-14. Solo from=1 ha date coerenti con la scheda.
  const eps = Array.from({ length: 12 }, (_, i) => ({
    n: i + 1,
    name: `Episodio ${i + 1}`,
    air: i < 6 ? '2011-03-30' : '2013-12-25',
  }));
  const c = {
    title: 'Freezing Specials',
    titles: [],
    episodes: 6,
    year: 2011,
    startDate: null,
    tmdbTitle: 'Freezing',
    s0: { eng: eps, ita: [], jpn: [] },
  };
  eps[5].name = 'Freezing Specials';
  const e = classificaS0(c, { episodes: 6, type: 'Special' });
  assert.equal(e.anchorEpisode, 6);
  assert.equal(e.from, 1);
  assert.equal(e.proposalReason, 'unique_date_consistent');
  assert.equal(e.rangeDetermined, false, 'le date sostengono, non dimostrano');
  assert.equal(e.rangeVerified, false);
  assert.equal(e.alternativeRanges.length, 6);
  assert.equal(e.alternativeRanges.filter((r) => r.dateSupport).length, 1);
});

test('S0 con buchi: un range che salta un numero non esiste', () => {
  // Numeri 1,2,4,5: la lunghezza e' 4, ma il range 2-4 salta il 3.
  const eps = [1, 2, 4, 5].map((n) => ({ n, name: `Episodio ${n}`, air: '2012-01-01' }));
  eps[1].name = 'Zeta Quest';
  const c = {
    title: 'Zeta Quest',
    titles: [],
    episodes: 3,
    year: 2012,
    startDate: '2012-01-01',
    tmdbTitle: 'Zeta Quest',
    s0: { eng: eps, ita: [], jpn: [] },
  };
  const e = classificaS0(c, { episodes: 3, type: 'OVA' });
  assert.equal(e.anchorEpisode, 2);
  assert.equal(e.alternativeRanges.length, 0, 'ne 2-4 ne 1-3 esistono: il 3 manca');
  assert.equal(e.from, null);
  assert.equal(e.proposalReason, 'no_valid_range');
});
