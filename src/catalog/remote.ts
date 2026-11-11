import fs from 'node:fs';
import { debug } from '../utils/logger.js';
import { catalogFile, catalogDir, recordCatalogAttempt } from './matcher.js';
import { writeJsonAtomic } from '../utils/fs.js';
import { CATALOG_SITES } from './sync.js';
import { buildTitleIndex, CATALOG_SCHEMA_VERSION } from './title-index.js';

/** Controllo ogni 6 ore, download al massimo una volta al giorno. */
export const CATALOG_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BYTES = 64 * 1024 * 1024;

/**
 * Scarica il catalogo dal branch `data` (CATALOG_URL, il file completo
 * `catalogs.json`) e ne costruisce l'indice che legge il matcher. Un solo file
 * pubblicato: l'indice costa ~22 ms a costruirlo e non vale un secondo download.
 * Best effort: senza URL, o con rete rotta, resta il file precedente e i
 * provider usano la ricerca di rete come prima.
 */
export async function refreshCatalogFromUrl(): Promise<void> {
  const url = process.env.CATALOG_URL;
  if (!url) return;
  const target = catalogFile();
  try {
    const mtime = fs.statSync(target).mtimeMs;
    if (Date.now() - mtime < CATALOG_TTL_MS && isUsable(target)) {
      debug(4, 'Catalog', 'catalogo locale fresco', { ageMs: Date.now() - mtime });
      return;
    }
  } catch {
    /* file assente: si scarica */
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text();
    if (body.length > MAX_BYTES) throw new Error(`payload troppo grande (${body.length} byte)`);
    const data = JSON.parse(body);
    const sites = data?.sites || {};
    // Tutti e tre, non "almeno uno": il matcher legge i tre siti e un sito
    // non-array fa lanciare `entries.filter` a ogni lookup, cioe' il provider
    // diventa muto invece di ricadere sulla ricerca di rete.
    for (const site of CATALOG_SITES) {
      const list = sites[site];
      if (!Array.isArray(list)) throw new Error(`schema non riconosciuto: ${site} non e' un array`);
      // Una scheda senza `titleSite` costruirebbe un indice vuoto (o lancia):
      // un `catalog-titles.json` scambiato per il catalogo si ferma qui.
      if (!list.every((entry: any) => entry && typeof entry === 'object' && typeof entry.titleSite === 'string')) {
        throw new Error(`schema non riconosciuto: scheda malformata in ${site}`);
      }
    }
    // Un file di formato vecchio verrebbe accettato e servirebbe zero hit in
    // silenzio fino alla scadenza del TTL: la versione deve esserci.
    if (data?.version !== CATALOG_SCHEMA_VERSION) {
      throw new Error(`versione di schema non supportata: ${data?.version} (attesa ${CATALOG_SCHEMA_VERSION})`);
    }
    // Il file locale resta l'indice: il matcher legge quello.
    fs.mkdirSync(catalogDir(), { recursive: true });
    writeJsonAtomic(target, buildTitleIndex(data));
    recordCatalogAttempt(null);
    debug(1, 'Catalog', 'catalogo aggiornato da CATALOG_URL', {
      saturn: sites.saturn?.length || 0,
      world: sites.world?.length || 0,
      unity: sites.unity?.length || 0,
      generatedAt: data.generatedAt,
    });
  } catch (err: any) {
    const message = err?.message || String(err);
    // Non basta un debug: con CATALOG_URL giù il primo sintomo era "ogni titolo
    // fa ricerca di rete", indistinguibile da un catalogo semplicemente vecchio.
    recordCatalogAttempt(message);
    console.warn('[Catalog] download del catalogo fallito, resta il file locale:', message);
  }
}

function isUsable(file: string): boolean {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return ['saturn', 'world', 'unity'].some((site) => (data?.sites?.[site] || []).length > 0);
  } catch {
    return false;
  }
}
