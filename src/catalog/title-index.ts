/**
 * L'indice dei titoli che il matcher legge: `catalog-titles.json`.
 *
 * Sta qui e non in `sync.ts` perche' lo costruisce anche l'addon: `sync.ts`
 * importa cheerio (serve solo al crawler), e importare `buildTitleIndex` da li'
 * tirerebbe il parser HTML dentro il runtime.
 */
import { compactKey } from './text.js';
import type { CatalogFile, CatalogSite, TitleIndexEntry, TitleIndexFile } from './sync.js';

/** Cambiare quando cambia la forma di `TitleIndexEntry`: un file vecchio va scartato, non servito a metà. */
export const CATALOG_SCHEMA_VERSION = 1;

const CATALOG_SITES: CatalogSite[] = ['saturn', 'world', 'unity'];

/** Dal catalogo completo (`catalogs.json`) all'indice che legge il matcher. */
export function buildTitleIndex(catalog: CatalogFile): TitleIndexFile {
  const sites = {} as Record<CatalogSite, TitleIndexEntry[]>;
  for (const site of CATALOG_SITES) {
    sites[site] = (catalog.sites[site] || []).map((entry) => ({
      slug: entry.slug,
      url: entry.url,
      title: entry.titleSite,
      key: compactKey(entry.titleSite),
      ...(entry.titles?.length ? { aliases: entry.titles } : {}),
      ...(entry.type ? { type: entry.type } : {}),
      ...(entry.malId ? { malId: entry.malId } : {}),
      ...(entry.language ? { language: entry.language } : {}),
      ...(entry.episodes ? { episodes: entry.episodes } : {}),
      ...(entry.ep ? { ep: entry.ep } : {}),
    }));
  }
  return { version: CATALOG_SCHEMA_VERSION, generatedAt: catalog.generatedAt, sites };
}
