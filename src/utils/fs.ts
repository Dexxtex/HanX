/**
 * Scrittura atomica su file: temporaneo + rename, così un crash non lascia mai
 * un file a metà.
 *
 * Stava in tre copie (`catalog/sync.ts`, `mapping/index.ts`, e lo script di
 * build). Quella di `sync.ts` era importata da `catalog/remote.ts`, cioè il
 * modulo di **runtime** dipendeva dal crawler di **CI** per una funzione di
 * dodici righe.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Contenuto già serializzato. */
export function writeAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, filePath);
}

/** Oggetto serializzato in JSON, con il newline finale che rende leggibile il diff. */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  writeAtomic(filePath, `${JSON.stringify(data)}\n`);
}
