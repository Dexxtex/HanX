import assert from 'node:assert/strict';
import { test } from 'node:test';

const { collectWithinBudget } = await import('../../dist/providers/anime-core/fanout.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('fan-out: tutti pronti entro il budget, nessun taglio', async () => {
  const out = await collectWithinBudget(
    [sleep(5).then(() => ['a']), sleep(10).then(() => ['b'])],
    { budgetMs: 200 }
  );
  assert.deepEqual(out.items.sort(), ['a', 'b']);
  assert.equal(out.truncated, false);
});

test('fan-out: budget scaduto con un provider pronto, si consegna quello', async () => {
  const out = await collectWithinBudget(
    [sleep(5).then(() => ['a']), sleep(500).then(() => ['b'])],
    { budgetMs: 50 }
  );
  assert.deepEqual(out.items, ['a']);
  assert.equal(out.truncated, true);
  assert.equal(out.readyAtBudget, 1);
});

test('fan-out: budget scaduto SENZA stream, aspetta il primo provider (lista vuota mai)', async () => {
  // Caso reale: serie fredda, tutti i provider finiscono oltre il budget.
  // Consegnare zero stream manderebbe il client su un episodio vuoto.
  const out = await collectWithinBudget(
    [sleep(120).then(() => ['a']), sleep(500).then(() => ['b'])],
    { budgetMs: 20 }
  );
  assert.deepEqual(out.items, ['a'], 'la lista non deve essere vuota');
  assert.equal(out.truncated, true);
  assert.equal(out.readyAtBudget, 0);
});

test('fan-out: tutti i provider rispondono vuoto, la lista resta vuota senza attendere oltre', async () => {
  const out = await collectWithinBudget(
    [sleep(5).then(() => []), sleep(10).then(() => [])],
    { budgetMs: 200 }
  );
  assert.deepEqual(out.items, []);
  assert.equal(out.truncated, false);
});

test('fan-out: budget 0 disattiva il taglio', async () => {
  const out = await collectWithinBudget(
    [sleep(5).then(() => ['a']), sleep(40).then(() => ['b'])],
    { budgetMs: 0 }
  );
  assert.deepEqual(out.items.sort(), ['a', 'b']);
  assert.equal(out.truncated, false);
});

test('fan-out: un provider che rigetta non blocca gli altri', async () => {
  const out = await collectWithinBudget(
    [Promise.reject(new Error('boom')).catch(() => []), sleep(5).then(() => ['b'])],
    { budgetMs: 200 }
  );
  assert.deepEqual(out.items, ['b']);
  assert.equal(out.truncated, false);
});
