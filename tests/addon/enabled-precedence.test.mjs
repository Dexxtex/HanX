import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// L'env è un kill switch, non una forzatura: con `??` un `=true` rendeva inerti
// le checkbox della landing, e env.example esce proprio con tutti `=true`.
const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', '..', 'dist', 'addon.js'), 'utf8');

test('i tre ENABLED usano il kill switch, non la forzatura', () => {
  const uses = source.match(/enabledBy\('(ANIMEUNITY|ANIMESATURN|ANIMEWORLD)_ENABLED'/g) || [];
  assert.equal(uses.length, 3, 'tutti e tre i provider devono passare da enabledBy');

  // La forma vecchia (`envFlag(...) ?? ...`) scavalca la config utente.
  assert.ok(
    !/envFlag\('ANIME(UNITY|SATURN|WORLD)_ENABLED'\)\s*\?\?/.test(source),
    'envFlag non deve più essere usato con ??: scavalcherebbe la scelta utente'
  );
  assert.match(source, /envFlag\(envName\) === false \? false/, 'solo `false` deve spegnere');
});
