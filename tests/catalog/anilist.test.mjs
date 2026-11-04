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
  const confirmed = await confirmMalIds(
    [
      { malId: 100, anilistId: 1 }, // coerente
      { malId: 200, anilistId: 2 }, // il sito dice 200, AniList dice 999: link sbagliato
    ],
    fetcher
  );
  assert.equal(calls.length, 1);
  assert.deepEqual([...confirmed.entries()], [[1, 100]]);
});

test('niente conferme quando AniList non risponde o non conosce l id', async () => {
  const broken = fakeAniList({}, { status: 429 });
  assert.equal((await confirmMalIds([{ malId: 1, anilistId: 2 }], broken.fetcher)).size, 0);

  const boom = fakeAniList({}, { boom: true });
  assert.equal((await confirmMalIds([{ malId: 1, anilistId: 2 }], boom.fetcher)).size, 0);

  const unknown = fakeAniList({});
  assert.equal((await confirmMalIds([{ malId: 1, anilistId: 2 }], unknown.fetcher)).size, 0);
});

test('le coppie incomplete non si mandano: senza id AniList non c e conferma', async () => {
  const { fetcher, calls } = fakeAniList({});
  const confirmed = await confirmMalIds(
    [
      { malId: 100, anilistId: null },
      { malId: null, anilistId: 7 },
      { malId: 0, anilistId: 0 },
    ],
    fetcher
  );
  assert.equal(calls.length, 0);
  assert.equal(confirmed.size, 0);
});

test('oltre 25 coppie si spezza in blocchi', async () => {
  const answers = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i + 1, i + 1]));
  const { fetcher, calls } = fakeAniList(answers);
  const pairs = Array.from({ length: 30 }, (_, i) => ({ malId: i + 1, anilistId: i + 1 }));
  const confirmed = await confirmMalIds(pairs, fetcher);
  assert.equal(calls.length, 2);
  assert.equal(confirmed.size, 30);
});
