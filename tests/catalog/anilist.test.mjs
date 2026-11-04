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
  const { confirmed, answered } = await confirmMalIds(pairs, fetcher, { delayMs: 0 });
  assert.equal(calls.length, 2);
  assert.equal(confirmed.size, 30);
  assert.equal(answered.size, 30);
});

// Finto AniList che riproduce il comportamento vero sul 404: se il blocco
// contiene un id inesistente risponde 404 e azzera **tutti** gli alias.
function fakeAniListPicky(known, bogus) {
  const calls = [];
  const fetcher = async (url, init) => {
    const query = JSON.parse(init.body).query;
    const ids = [...query.matchAll(/Media\(id:(\d+),type:ANIME\)/g)].map((m) => Number(m[1]));
    calls.push(ids);
    if (ids.some((id) => bogus.has(id))) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ errors: [{ message: 'Not Found.' }], data: Object.fromEntries(ids.map((_, i) => [`a${i}`, null])) }),
      };
    }
    const data = {};
    ids.forEach((id, i) => {
      data[`a${i}`] = known[id] === undefined ? null : { idMal: known[id] };
    });
    return { ok: true, status: 200, json: async () => ({ data }) };
  };
  return { fetcher, calls };
}

test('un id inesistente non fa perdere le conferme degli altri (404 → dimezza)', async () => {
  // 30 coppie con un anilistId inesistente **dentro** il primo blocco: la query
  // da 25 risponde 404 e senza dimezzamento si perderebbero 24 malId buoni.
  const bogus = 999_999_999;
  const pairs = Array.from({ length: 30 }, (_, i) => ({ malId: i + 1, anilistId: i + 1 }));
  pairs[12] = { malId: 9_999, anilistId: bogus };
  const known = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i + 1, i + 1]));
  const { fetcher, calls } = fakeAniListPicky(known, new Set([bogus]));
  const { confirmed, answered } = await confirmMalIds(pairs, fetcher, { delayMs: 0 });
  assert.equal(confirmed.size, 29, 'tutti i validi confermati, anche quelli del blocco avvelenato');
  assert.equal(answered.size, 30, 'il colpevole è risposto (no definitivo), così esce dalla coda');
  assert.equal(answered.has(bogus), true);
  assert.equal(confirmed.has(bogus), false);
  // Dimezzamento: ~2·log₂(25) richieste una volta sola, non 25.
  assert.ok(calls.length > 2 && calls.length <= 14, `richieste: ${calls.length}`);
});

test('un 5xx non moltiplica le richieste (niente dimezzamento)', async () => {
  const { fetcher, calls } = fakeAniList({}, { status: 503 });
  const pairs = Array.from({ length: 25 }, (_, i) => ({ malId: i + 1, anilistId: i + 1 }));
  const { confirmed, answered } = await confirmMalIds(pairs, fetcher, { delayMs: 0 });
  assert.equal(calls.length, 1);
  assert.equal(confirmed.size, 0);
  assert.equal(answered.size, 0);
});
