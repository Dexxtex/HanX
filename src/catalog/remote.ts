import fs from 'node:fs';
import { debug } from '../utils/logger.js';
import { catalogFile, catalogDir } from './matcher.js';
import { writeJsonAtomic } from './sync.js';

/** Controllo ogni 6 ore, download al massimo una volta al giorno. */
export const CATALOG_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BYTES = 64 * 1024 * 1024;

/**
 * Scarica il catalogo dal branch `data` (CATALOG_URL) nella posizione che legge
 * il matcher. Best effort: senza URL, o con rete rotta, resta il file
 * precedente e i provider usano la ricerca di rete come prima.
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
    if (!Array.isArray(sites.saturn) && !Array.isArray(sites.world) && !Array.isArray(sites.unity)) {
      throw new Error('schema non riconosciuto');
    }
    fs.mkdirSync(catalogDir(), { recursive: true });
    writeJsonAtomic(target, data);
    debug(1, 'Catalog', 'catalogo aggiornato da CATALOG_URL', {
      saturn: sites.saturn?.length || 0,
      world: sites.world?.length || 0,
      unity: sites.unity?.length || 0,
      generatedAt: data.generatedAt,
    });
  } catch (err: any) {
    debug(1, 'Catalog', 'download del catalogo fallito, resta il file locale', { error: err?.message || String(err) });
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
