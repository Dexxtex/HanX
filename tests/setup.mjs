import os from 'node:os';
import path from 'node:path';

// Setup dei test: il pacing di fetch-resource mette 2 s tra due richieste allo
// stesso host (in produzione serve), e qui renderebbe la suite lentissima.
process.env.ANIME_HOST_MIN_INTERVAL_MS = '0';
// Il catalogo dei titoli vive in data/ sul deploy: se i test lo leggono, i
// risultati dipendono dai file presenti nel repo. Cartella vuota per default;
// i test che vogliono un catalogo puntano CATALOG_DIR a una fixture.
process.env.CATALOG_DIR = process.env.CATALOG_DIR || path.join(os.tmpdir(), 'hanx-test-catalog-vuoto');

// Nessun test deve poter raggiungere i siti veri. I file che hanno bisogno di
// un fetch finto lo installano loro prima dell'import (fetch-resource cattura
// `globalThis.fetch` al load); questo è il default per chi se ne dimentica: una
// richiesta senza stub sparerebbe ai siti senza pacing, che è il profilo del
// 403 del 25/10. Un server locale di test resta permesso.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : String(input?.url || input);
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    /* non è una URL: la blocca il throw sotto */
  }
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') {
    return realFetch(input, init);
  }
  throw new Error(`rete vietata nei test: ${url}`);
};
