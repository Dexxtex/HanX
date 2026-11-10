import assert from 'node:assert/strict';
import { test } from 'node:test';

// Importare `addon.js` non deve legare una porta né armare i timer: è la
// condizione per poter provare il fan-out a comportamento invece che con una
// regex sul compilato. Prima dell'estrazione, questo import avviava il server.
test('importare addon.js non avvia il server', async () => {
  const before = process._getActiveHandles().length;
  const mod = await import('../../dist/addon.js');
  const after = process._getActiveHandles().length;

  assert.equal(typeof mod.createBuilder, 'function', 'createBuilder deve essere esportata');
  // Esattamente zero: con `< 3` un `setInterval` armato all'import o un
  // `app.listen` (un handle ciascuno) lasciavano il test verde, cioè proprio le
  // due cose che questo file dichiara di impedire.
  assert.equal(after - before, 0, `nessun handle di rete nuovo (${before} -> ${after})`);
});

test('createBuilder costruisce un builder senza toccare la rete', async () => {
  const { createBuilder } = await import('../../dist/addon.js');
  const builder = createBuilder();
  // Il builder dell'SDK espone defineStreamHandler: è il metodo che registra
  // l'handler del fan-out, quindi la prova che il builder è quello vero.
  assert.equal(typeof builder.defineStreamHandler, 'function');
  assert.equal(typeof builder.getInterface, 'function');
});
