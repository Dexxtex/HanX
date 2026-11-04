import os from 'node:os';
import path from 'node:path';

// Setup dei test: il pacing di fetch-resource mette 2 s tra due richieste allo
// stesso host (in produzione serve), e qui renderebbe la suite lentissima.
process.env.ANIME_HOST_MIN_INTERVAL_MS = '0';
// Il catalogo dei titoli vive in data/ sul deploy: se i test lo leggono, i
// risultati dipendono dai file presenti nel repo. Cartella vuota per default;
// i test che vogliono un catalogo puntano CATALOG_DIR a una fixture.
process.env.CATALOG_DIR = process.env.CATALOG_DIR || path.join(os.tmpdir(), 'hanx-test-catalog-vuoto');
