import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const { lookupTitle } = await import('../../dist/catalog/matcher.js');

// Un file corrotto non deve amplificare il costo: senza cache dell'esito,
// ogni lookup (3 per richiesta) rifà stat + read + parse di tutto il file.
test('catalogo corrotto: il file si legge una volta, non a ogni lookup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hanx-corrupt-'));
  const file = path.join(dir, 'catalog-titles.json');
  fs.writeFileSync(file, '{ questo non è json');
  process.env.CATALOG_DIR = dir;

  // Conta le read vere: se il catch non memorizza, sono 3.
  let reads = 0;
  const original = fs.readFileSync;
  fs.readFileSync = (...args) => { reads += 1; return original(...args); };
  try {
    for (let i = 0; i < 3; i += 1) {
      assert.deepEqual(lookupTitle('saturn', ['Tokyo Revengers'], { season: 1 }).hits, []);
    }
  } finally {
    fs.readFileSync = original;
  }
  assert.equal(reads, 1, 'il file corrotto va letto una volta sola');
});
