import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// La 1.1.6 introdusse un budget di risposta: `Promise.race([Promise.all(...),
// timeout])`. Su una serie mai vista nessun provider finisce entro il budget,
// quindi la lista usciva con 0-2 provider su 3.
//
// L'attesa vera vive in `src/stream.ts` ed è coperta a comportamento da
// `stream-fanout.test.mjs`: quello è il test che conta. Questo file guarda il
// chiamante, dove il budget verrebbe messo: resta strutturale, e va detto.

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', '..', 'dist');
const addonSource = fs.readFileSync(path.join(dist, 'addon.js'), 'utf8');
const streamSource = fs.readFileSync(path.join(dist, 'stream.js'), 'utf8');

test('il fan-out aspetta tutti i provider: nessun budget di risposta', () => {
  // L'attesa è delegata a stream.ts, non replicata qui.
  assert.match(addonSource, /collectProviderStreams\(providerPromises\)/);
  assert.match(streamSource, /await Promise\.all\(runs\)/);

  // Nessun race deve avvolgere providerPromises o le run: il timeout per
  // singolo provider (30 s) resta e non c'entra, quello è dentro runProvider.
  for (const [name, source] of [['addon.js', addonSource], ['stream.js', streamSource]]) {
    const racing = source
      .split('\n')
      .filter((line) => /Promise\.race/.test(line) && /providerPromises|runs/.test(line));
    assert.deepEqual(racing, [], `nessun Promise.race sul fan-out (${name})`);
  }

  // Il nome della variabile d'ambiente del vecchio budget non deve tornare.
  assert.ok(
    !/STREAM_RESPONSE_BUDGET/.test(addonSource + streamSource),
    'STREAM_RESPONSE_BUDGET_MS tagliava la lista: non deve esistere'
  );
});

test('la lista parziale non entra in cache', () => {
  const lines = addonSource.split('\n');
  const setIndex = lines.findIndex((line) => /_providerCacheSet\(normalizedType/.test(line));
  assert.ok(setIndex > 0, 'il cache-set del fan-out deve esistere');
  const guard = lines[setIndex - 1];
  assert.match(guard, /if \(!providerFailure/, 'un provider fallito non deve cachare la lista');
});
