#!/usr/bin/env node
/**
 * Catalogo locale AnimeSaturn / AnimeWorld / AnimeUnity.
 *
 * Budget di rete (dichiarato prima delle richieste, regole in AGENTS.md):
 * - una richiesta alla volta, 3 s tra la fine di una e l'inizio della successiva;
 * - timeout 15 s, User-Agent esplicito, 2 retry con backoff solo su 5xx/rete;
 * - 403 e 429 fermano tutto: il WAF si prolunga se si insiste;
 * - tetti giornalieri: Saturn ~2 richieste (sitemap), World 160 pagine (40
 *   schede), Unity 1 + 300 pagine (30 schede). Totale massimo ~463, ~22 minuti:
 *   un crawl completo di tutti e tre i siti non entrerebbe nei 30 minuti del job.
 *
 * Uso: npm run sync-catalog [-- --site unity --max-pages 2 --dry-run]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATALOG_SITES,
  buildTitleIndex,
  diffEntries,
  emptyCatalog,
  mergeSite,
  parseSaturnAnimeSitemap,
  parseSaturnSitemapIndex,
  parseUnityRecords,
  parseWorldFilterPage,
  readCatalog,
  writeCatalogsAtomic,
  type CatalogEntry,
  type CatalogSite,
} from '../src/catalog/sync.js';

const DATA_DIR = path.resolve(fileURLToPath(new URL('../data', import.meta.url)));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const TIMEOUT_MS = Number(process.env.CATALOG_TIMEOUT_MS) || 15_000;
const INTERVAL_MS = Math.max(3_000, Number(process.env.CATALOG_INTERVAL_MS) || 3_000);
const RETRIES = 2;
const BACKOFF_MS = [1_500, 4_000];

const BASES = {
  saturn: 'https://www.animesaturn.net',
  world: 'https://www.animeworld.ac',
  unity: 'https://www.animeunity.co',
} as const;

class BlockedError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const cookies = new Map<string, string>();
let nextSlot = 0;

function cookieHeader(): string {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

function rememberCookies(headers: Headers): void {
  for (const line of headers.getSetCookie?.() || []) {
    const [pair] = line.split(';');
    const index = pair.indexOf('=');
    if (index > 0) cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}

/** Una richiesta alla volta, con lo slot successivo calcolato dalla fine della precedente. */
async function request(url: string, init: RequestInit = {}): Promise<{ body: string; headers: Headers }> {
  for (let attempt = 0; ; attempt += 1) {
    const wait = nextSlot - Date.now();
    if (wait > 0) await sleep(wait);
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'user-agent': UA, 'accept-language': 'it-IT,it;q=0.9', ...(init.headers as Record<string, string>) },
      });
    } catch (err) {
      if (attempt >= RETRIES) throw err;
      await sleep(BACKOFF_MS[attempt]);
      continue;
    } finally {
      nextSlot = Date.now() + INTERVAL_MS;
    }
    rememberCookies(response.headers);
    if (response.status === 403 || response.status === 429) {
      throw new BlockedError(`${response.status} su ${url}`);
    }
    if (response.status >= 500 && attempt < RETRIES) {
      await sleep(BACKOFF_MS[attempt]);
      continue;
    }
    if (!response.ok) throw new Error(`${response.status} su ${url}`);
    return { body: await response.text(), headers: response.headers };
  }
}

interface CrawlResult {
  entries: CatalogEntry[];
  /** Il tetto di pagine ha troncato il catalogo: va detto, non nascosto. */
  capped: boolean;
}

async function crawlSaturn(maxPages: number): Promise<CrawlResult> {
  const index = await request(`${BASES.saturn}/sitemap.xml`);
  const parts = parseSaturnSitemapIndex(index.body);
  if (!parts.length) throw new Error('sitemap index senza parti /sitemap-anime-*.xml');
  const entries: CatalogEntry[] = [];
  for (const part of parts.slice(0, maxPages)) {
    entries.push(...parseSaturnAnimeSitemap((await request(part)).body));
  }
  return { entries, capped: parts.length > maxPages };
}

async function crawlWorld(maxPages: number): Promise<CrawlResult> {
  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= maxPages; page += 1) {
    const html = await request(`${BASES.world}/filter?page=${page}`);
    const fresh = parseWorldFilterPage(html.body).filter((entry) => !seen.has(entry.slug));
    // Pagina vuota o identica alla precedente: la paginazione è finita.
    if (!fresh.length) return { entries, capped: false };
    for (const entry of fresh) seen.add(entry.slug);
    entries.push(...fresh);
  }
  return { entries, capped: true };
}

function csrfFrom(html: string): { xsrf: string; token: string } {
  const xsrf = decodeURIComponent(cookies.get('XSRF-TOKEN') || '');
  const token = html.match(/name="csrf-token"\s+content="([^"]+)"/)?.[1] || '';
  return { xsrf, token };
}

async function crawlUnity(maxPages: number): Promise<CrawlResult> {
  // Il GET serve al token CSRF (Laravel) e fa da canary: i dati arrivano dal POST.
  const page = await request(`${BASES.unity}/archivio`);
  const { xsrf, token } = csrfFrom(page.body);
  if (!xsrf && !token) throw new Error('nessun token CSRF su /archivio');
  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  for (let chunk = 0; chunk < maxPages && offset < total; chunk += 1) {
    const response = await request(`${BASES.unity}/archivio/get-animes`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'XMLHttpRequest',
        referer: `${BASES.unity}/archivio`,
        ...(xsrf ? { 'x-xsrf-token': xsrf } : {}),
        ...(token ? { 'x-csrf-token': token } : {}),
        cookie: cookieHeader(),
      },
      body: JSON.stringify({
        title: '', type: '', year: '', order: '', status: '', genres: [], dubbed: '', season: '',
        offset,
      }),
    });
    const parsed = parseUnityRecords(JSON.parse(response.body));
    if (parsed.total) total = parsed.total;
    if (!parsed.entries.length) break;
    for (const entry of parsed.entries) {
      if (seen.has(entry.slug)) continue;
      seen.add(entry.slug);
      entries.push(entry);
    }
    offset += parsed.entries.length;
  }
  return { entries, capped: offset < total };
}

const CRAWLERS: Record<CatalogSite, (maxPages: number) => Promise<CrawlResult>> = {
  saturn: crawlSaturn,
  world: crawlWorld,
  unity: crawlUnity,
};

interface Options {
  sites: CatalogSite[];
  maxPages: Record<CatalogSite, number>;
  dryRun: boolean;
  dataDir: string;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    sites: [...CATALOG_SITES],
    maxPages: {
      saturn: 10,
      world: Number(process.env.CATALOG_WORLD_MAX_PAGES) || 160,
      unity: Number(process.env.CATALOG_UNITY_MAX_PAGES) || 300,
    },
    dryRun: false,
    dataDir: DATA_DIR,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--site') {
      const site = argv[++i] as CatalogSite;
      if (!CATALOG_SITES.includes(site)) throw new Error(`sito sconosciuto: ${site}`);
      options.sites = [site];
    } else if (arg === '--max-pages') {
      const pages = Number(argv[++i]);
      if (!Number.isFinite(pages) || pages < 1) throw new Error('--max-pages vuole un intero positivo');
      for (const site of options.sites) options.maxPages[site] = pages;
    } else if (arg === '--data-dir') {
      options.dataDir = path.resolve(argv[++i]);
    } else {
      throw new Error(`opzione sconosciuta: ${arg}`);
    }
  }
  return options;
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const previous = readCatalog(options.dataDir);
  const catalog = emptyCatalog();
  const startedAt = Date.now();
  let blocked = false;
  let failure: string | null = null;

  for (const site of CATALOG_SITES) {
    if (!options.sites.includes(site)) {
      catalog.sites[site] = previous.sites[site];
      if (previous.truncated[site]) catalog.truncated[site] = true;
      continue;
    }
    const siteStart = Date.now();
    let result: CrawlResult;
    try {
      result = await CRAWLERS[site](options.maxPages[site]);
    } catch (err: any) {
      const isBlocked = err instanceof BlockedError;
      console.error(`[catalog] ${site}: ${isBlocked ? 'BLOCCATO' : 'errore'} — ${err?.message || err}`);
      console.error(`[catalog] ${site}: catalogo precedente mantenuto (${previous.sites[site].length} schede)`);
      catalog.sites[site] = previous.sites[site];
      if (previous.truncated[site]) catalog.truncated[site] = true;
      if (isBlocked) {
        blocked = true;
        break;
      }
      continue;
    }
    const merged = mergeSite(site, previous.sites[site] || [], result.entries);
    if (!merged.accepted) {
      console.error(`[catalog] ${site}: ${merged.reason}`);
      catalog.sites[site] = previous.sites[site];
      if (previous.truncated[site]) catalog.truncated[site] = true;
      failure = merged.reason || `${site}: catalogo incompleto`;
      continue;
    }
    const diff = diffEntries(previous.sites[site] || [], merged.entries);
    catalog.sites[site] = merged.entries;
    if (result.capped) catalog.truncated[site] = true;
    const capped = result.capped ? ` (tetto ${options.maxPages[site]} pagine raggiunto)` : '';
    console.log(
      `[catalog] ${site.padEnd(6)} ${String(merged.entries.length).padStart(6)} schede  ` +
        `+${diff.added}/-${diff.removed}  ${((Date.now() - siteStart) / 1000).toFixed(1)}s${capped}`
    );
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const total = CATALOG_SITES.reduce((sum, site) => sum + catalog.sites[site].length, 0);
  if (blocked || failure) {
    console.error(`[catalog] nessuna scrittura: il catalogo pubblicato resta quello di ieri (${elapsed}s)`);
    return 1;
  }
  if (options.dryRun) {
    console.log(`[catalog] dry-run: ${total} schede, nessun file scritto (${elapsed}s)`);
    return 0;
  }
  catalog.generatedAt = new Date().toISOString();
  writeCatalogsAtomic(options.dataDir, catalog, buildTitleIndex(catalog));
  console.log(`[catalog] ${total} schede in ${elapsed}s -> data/catalogs.json, data/catalog-titles.json`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`[catalog] errore fatale: ${err?.message || err}`);
    process.exit(1);
  }
);
