import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// La 1.1.6 introdusse un budget di risposta: `Promise.race([Promise.all(...),
// timeout])`. Su una serie mai vista nessun provider finisce entro il budget,
// quindi la lista usciva con 0-2 provider su 3. I test di allora non lo videro
// perche' asserivano il corpo di `runProvider`, non il fan-out.
//
// Il fan-out e' inline nell'handler della richiesta, quindi non e' raggiungibile
// da un test di comportamento senza avviare il server con tre provider finti.
// Questo test guarda il codice compilato: e' strutturale, e va detto.

const here = path.dirname(fileURLToPath(import.meta.url));
const addonSource = fs.readFileSync(path.join(here, '..', '..', 'dist', 'addon.js'), 'utf8');

test('il fan-out aspetta tutti i provider: nessun budget di risposta', () => {
  const lines = addonSource.split('\n');
  const fanout = lines.filter((line) => /await\s+Promise\.all\(\s*providerPromises\s*\)/.test(line));
  assert.equal(fanout.length, 1, 'il fan-out deve essere un Promise.all su providerPromises');

  // Nessun race/timeout deve avvolgere l'attesa dei provider: il timeout per
  // singolo provider (30 s) resta e non c'entra, quello e' dentro runProvider.
  const racing = lines.filter(
    (line) => /Promise\.race/.test(line) && /providerPromises/.test(line)
  );
  assert.deepEqual(racing, [], 'nessun Promise.race sul fan-out');

  // Il nome della variabile d'ambiente del vecchio budget non deve tornare.
  assert.ok(
    !/STREAM_RESPONSE_BUDGET/.test(addonSource),
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
