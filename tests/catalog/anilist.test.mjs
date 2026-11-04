import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmMalIds } from '../../dist/catalog/anilist.js';

// Finto AniList: risponde alle alias della query con gli idMal indicati.
function fakeAniList(answers, { status = 200, boom = false } = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, body: init.body });
    if (boom) throw new Error('rete');
    const query = JSON.parse(init.body).query;
    const data = {};
    for (const [, alias, id] of query.matchAll(/(a\d+):Media\(id:(\d+),type:ANIME\)/g)) {
      data[alias] = answers[id] === undefined ? null : { idMal: answers[id] };
    }
    return { ok: status === 200, status, json: async () => ({ data }) };
  };
  return { fetcher, calls };
}

test('malId confermato solo quando AniList dice che è lo stesso anime', async () => {
  const { fetcher, calls } = fakeAniList({ 1: 100, 2: 999 });
  const { confirmed, answered } = await confirmMalIds(
    [
      { malId: 100, anilistId: 1 }, // coerente
      { malId: 200, anilistId: 2 }, // il sito dice 200, AniList dice 999: link sbagliato
    ],
    fetcher
  );
  assert.equal(calls.length, 1);
  assert.deepEqual([...confirmed.entries()], [[1, 100]]);
  // AniList ha risposto per entrambe: il no su 2 è definitivo.
  assert.deepEqual([...answered].sort(), [1, 2]);
});

test('niente conferme quando AniList non risponde o non conosce l id', async () => {
  const broken = fakeAniList({}, { status: 429 });
  const rateLimited = await confirmMalIds([{ malId: 1, anilistId: 2 }], broken.fetcher);
  assert.equal(rateLimited.confirmed.size, 0);
  assert.equal(rateLimited.answered.size, 0);

  const boom = fakeAniList({}, { boom: true });
  const offline = await confirmMalIds([{ malId: 1, anilistId: 2 }], boom.fetcher);
  assert.equal(offline.confirmed.size, 0);
  assert.equal(offline.answered.size, 0);

  // Risposta ok ma media assente: nessun idMal da confrontare, ma la risposta c'è.
  const unknown = fakeAniList({});
  const missing = await confirmMalIds([{ malId: 1, anilistId: 2 }], unknown.fetcher);
  assert.equal(missing.confirmed.size, 0);
  assert.deepEqual([...missing.answered], [2]);
});

test('risposta con idMal null: risponde (answered) ma non conferma', async () => {
  const { fetcher } = fakeAniList({ 5: null });
  const { confirmed, answered } = await confirmMalIds([{ malId: 500, anilistId: 5 }], fetcher);
  assert.equal(confirmed.size, 0);
  assert.deepEqual([...answered], [5]);
});

test('le coppie incomplete non si mandano: senza id AniList non c e conferma', async () => {
  const { fetcher, calls } = fakeAniList({});
  const { confirmed, answered } = await confirmMalIds(
    [
      { malId: 100, anilistId: null },
      { malId: null, anilistId: 7 },
      { malId: 0, anilistId: 0 },
    ],
    fetcher
  );
  assert.equal(calls.length, 0);
  assert.equal(confirmed.size, 0);
  assert.equal(answered.size, 0);
});

test('oltre 25 coppie si spezza in blocchi', async () => {
  const answers = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i + 1, i + 1]));
  const { fetcher, calls } = fakeAniList(answers);
  const pairs = Array.from({ length: 30 }, (_, i) => ({ malId: i + 1, anilistId: i + 1 }));
  const { confirmed, answered } = await confirmMalIds(pairs, fetcher);
  assert.equal(calls.length, 2);
  assert.equal(confirmed.size, 30);
  assert.equal(answered.size, 30);
});
