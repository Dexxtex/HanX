import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { compactKey } from './text.js';

export type CatalogSite = 'saturn' | 'world' | 'unity';

export const CATALOG_SITES: CatalogSite[] = ['saturn', 'world', 'unity'];

export interface CatalogEntry {
  site: CatalogSite;
  /** Identificativo usato dal provider per costruire la URL della scheda. */
  slug: string;
  url: string;
  /** Titolo mostrato dal sito. Saturn non lo espone nelle sitemap: arriva dallo slug. */
  titleSite: string;
  /** Titoli alternativi (italiano/inglese/romaji) quando il sito li pubblica. */
  titles?: string[];
  year?: number | null;
  /** Solo AnimeUnity: TV/Movie. Un film non è l'episodio di una serie. */
  type?: string;
}

export interface CatalogFile {
  generatedAt: string | null;
  sites: Record<CatalogSite, CatalogEntry[]>;
  /** Il tetto di pagine ha tagliato il catalogo: non è completo. */
  truncated: Partial<Record<CatalogSite, boolean>>;
}

export interface TitleIndexEntry {
  slug: string;
  url: string;
  title: string;
  /** compactKey(title): evita di rinormalizzare 15k titoli a ogni match. */
  key: string;
  aliases?: string[];
  type?: string;
}

export interface TitleIndexFile {
  generatedAt: string | null;
  sites: Record<CatalogSite, TitleIndexEntry[]>;
  truncated: Partial<Record<CatalogSite, boolean>>;
}

export function emptyCatalog(): CatalogFile {
  return { generatedAt: null, sites: { saturn: [], world: [], unity: [] }, truncated: {} };
}

/** Il token finale alfabetico/numerico di Saturn e World è casuale: non fa parte dello slug. */
const URL_TOKEN = /-[A-Za-z0-9]{5}$/;
const WORLD_URL_TOKEN = /\.[A-Za-z0-9]{5}$/;

function slugTitle(slug: string): string {
  return slug
    .replace(URL_TOKEN, '')
    .replace(/-/g, ' ')
    .trim()
    .replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

/** Sitemap index di Saturn: solo le parti con le schede anime, non episodi e pagine. */
export function parseSaturnSitemapIndex(xml: string): string[] {
  const $ = cheerio.load(String(xml || ''), { xmlMode: true });
  return $('sitemap > loc')
    .toArray()
    .map((el) => $(el).text().trim())
    .filter((url) => /\/sitemap-anime-\d+\.xml$/.test(url));
}

export function parseSaturnAnimeSitemap(xml: string, site: CatalogSite = 'saturn'): CatalogEntry[] {
  const $ = cheerio.load(String(xml || ''), { xmlMode: true });
  const out: CatalogEntry[] = [];
  $('url > loc').each((_, el) => {
    const url = $(el).text().trim();
    const match = url.match(/\/anime\/([^/?#]+)\/?$/);
    if (!match) return;
    const slug = match[1];
    out.push({ site, slug, url, titleSite: slugTitle(slug) });
  });
  return out;
}

/** Una pagina di /filter: una scheda per .film-list .item, titolo in a.name o alt della locandina. */
export function parseWorldFilterPage(html: string): CatalogEntry[] {
  const $ = cheerio.load(String(html || ''));
  const out: CatalogEntry[] = [];
  const seen = new Set<string>();
  $('.film-list .item').each((_, item) => {
    const $item = $(item);
    const href = String($item.find('a.poster').first().attr('href') || '').trim();
    const path = href.match(/^\/play\/([^/?#]+)/)?.[1];
    if (!path) return;
    // La scheda si riferisce all'anime, non al singolo episodio: /play/<slug>.<token>.
    const slug = path.replace(WORLD_URL_TOKEN, '');
    if (seen.has(slug)) return;
    seen.add(slug);
    const title = (
      $item.find('a.name').first().text().trim() ||
      String($item.find('img[alt]').first().attr('alt') || '').trim()
    ).replace(/\s+/g, ' ');
    if (!title) return;
    out.push({ site: 'world', slug, url: `https://www.animeworld.ac/play/${path}`, titleSite: title });
  });
  return out;
}

interface UnityRecord {
  id?: number;
  slug?: string;
  title?: string;
  title_eng?: string;
  title_it?: string;
  date?: string;
  type?: string;
}

/** POST /archivio/get-animes: { tot, records: [...] }, 30 schede per risposta. */
export function parseUnityRecords(payload: unknown): { total: number; entries: CatalogEntry[] } {
  const data = (payload || {}) as { tot?: unknown; records?: unknown };
  const records: UnityRecord[] = Array.isArray(data.records) ? (data.records as UnityRecord[]) : [];
  const entries: CatalogEntry[] = [];
  for (const record of records) {
    const id = Number(record?.id);
    const slug = String(record?.slug || '').trim();
    if (!Number.isFinite(id) || id <= 0 || !slug) continue;
    // Il sito lascia `title` vuoto su alcune schede (.hack, 830): il titolo
    // italiano o inglese evita di perdere la scheda, lo slug è l'ultima spiaggia.
    const names = [record.title, record.title_it, record.title_eng]
      .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const titleSite = names[0] || slugTitle(slug);
    const titles = [...new Set(names.slice(1))].filter((value) => value !== titleSite);
    const year = /^\d{4}$/.test(String(record.date || '')) ? Number(record.date) : null;
    entries.push({
      site: 'unity',
      slug: `${id}-${slug}`,
      url: `https://www.animeunity.co/anime/${id}-${slug}`,
      titleSite,
      ...(titles.length ? { titles } : {}),
      ...(year ? { year } : {}),
      ...(record.type ? { type: record.type } : {}),
    });
  }
  return { total: Number(data.tot) || 0, entries };
}

/**
 * Il catalogo di un sito sostituisce il precedente solo se ha almeno il 70%
 * delle schede: sotto quella soglia la sitemap è rotta o il WAF ha risposto
 * una pagina vuota, e i dati di ieri valgono più di quelli di oggi.
 */
export function mergeSite(
  site: CatalogSite,
  previous: CatalogEntry[],
  next: CatalogEntry[],
  minRatio = 0.7
): { entries: CatalogEntry[]; accepted: boolean; reason?: string } {
  if (previous.length && next.length < previous.length * minRatio) {
    return {
      entries: previous,
      accepted: false,
      reason: `${site}: ${next.length} schede contro ${previous.length} di ieri (sotto il ${Math.round(minRatio * 100)}%)`,
    };
  }
  return { entries: next, accepted: true };
}

export function diffEntries(previous: CatalogEntry[], next: CatalogEntry[]): { added: number; removed: number } {
  const before = new Set(previous.map((entry) => entry.slug));
  const after = new Set(next.map((entry) => entry.slug));
  let added = 0;
  let removed = 0;
  for (const slug of after) if (!before.has(slug)) added += 1;
  for (const slug of before) if (!after.has(slug)) removed += 1;
  return { added, removed };
}

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
    }));
  }
  return { generatedAt: catalog.generatedAt, sites, truncated: catalog.truncated || {} };
}

/** Scrive prima i due temporanei, poi rinomina: un crash non lascia file a metà. */
export function writeCatalogsAtomic(dir: string, catalog: CatalogFile, index: TitleIndexFile): void {
  fs.mkdirSync(dir, { recursive: true });
  const files: [string, unknown][] = [
    [path.join(dir, 'catalogs.json'), catalog],
    [path.join(dir, 'catalog-titles.json'), index],
  ];
  const temps = files.map(([file, data]) => {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(data)}\n`);
    return { file, tmp };
  });
  for (const { file, tmp } of temps) fs.renameSync(tmp, file);
}

export function readCatalog(dir: string): CatalogFile {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'catalogs.json'), 'utf8'));
    const catalog = emptyCatalog();
    catalog.generatedAt = typeof raw?.generatedAt === 'string' ? raw.generatedAt : null;
    for (const site of CATALOG_SITES) {
      if (Array.isArray(raw?.sites?.[site])) catalog.sites[site] = raw.sites[site] as CatalogEntry[];
      if (raw?.truncated?.[site]) catalog.truncated[site] = true;
    }
    return catalog;
  } catch {
    return emptyCatalog();
  }
}
