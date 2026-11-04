#!/usr/bin/env node
/**
 * Catalogo locale AnimeSaturn / AnimeWorld / AnimeUnity.
 *
 * Budget di rete (dichiarato prima delle richieste, regole in AGENTS.md):
 * - una richiesta alla volta, 3 s tra la fine di una e l'inizio della successiva;
 * - timeout 15 s, User-Agent esplicito, 2 retry con backoff solo su 5xx/rete;
 * - 403 e 429 fermano tutto: il WAF si prolunga se si insiste;
 * - tetti giornalieri: Saturn ~2 richieste (sitemap), World fino alle pagine
 *   dichiarate dal sito (172 oggi, 40 schede) con tetto 300, Unity 1 + 300
 *   pagine (30 schede). Totale massimo ~545, ~29 minuti; il tetto di World è
 *   solo una sicurezza, `truncated` scatta se il dichiarato lo supera.
 *
 * Uso: npm run sync-catalog [-- --site unity --max-pages 2 --dry-run]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { SocksProxyAgent } from 'socks-proxy-agent';
import {
  CATALOG_SITES,
  buildTitleIndex,
  diffEntries,
  emptyCatalog,
  mergeSite,
  parseSaturnAnimeSitemap,
  parseSaturnSitemapIndex,
  parseWorldMaxPage,
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

/**
 * Proxy per l'intero crawl (IP residenziale): http(s) o socks. Un solo IP per
 * tutta la run, altrimenti il cookie di sessione di Unity si rompe: se il pool
 * ruota, chiedere una sessione sticky. Non è un fix del WAF, è un cambio di IP.
 */
const PROXY = String(process.env.CATALOG_PROXY || process.env.AU_PROXY || '').trim();
const DISPATCHER = PROXY ? (/^socks/i.test(PROXY) ? new SocksProxyAgent(PROXY) : new ProxyAgent(PROXY)) : undefined;

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
      response = await undiciFetch(url, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'user-agent': UA, 'accept-language': 'it-IT,it;q=0.9', ...(init.headers as Record<string, string>) },
        ...(DISPATCHER ? { dispatcher: DISPATCHER } : {}),
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
  let declared: number | null = null;
  for (let page = 1; page <= (declared === null ? maxPages : Math.min(maxPages, declared)); page += 1) {
    const html = await request(`${BASES.world}/filter?page=${page}`);
    if (page === 1) {
      declared = parseWorldMaxPage(html.body);
      if (declared !== null) console.log(`[catalog] world: il sito dichiara ${declared} pagine`);
    }
    const fresh = parseWorldFilterPage(html.body).filter((entry) => !seen.has(entry.slug));
    // Oltre l'ultima pagina il sito ripete la prima: nessuna scheda nuova = fine.
    if (!fresh.length) return { entries, capped: false };
    for (const entry of fresh) seen.add(entry.slug);
    entries.push(...fresh);
  }
  // Troncato solo se il dichiarato supera il tetto, o se il numero non è dichiarato.
  return { entries, capped: declared === null || declared > maxPages };
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
  let capped = false;
  // Due cataloghi disgiunti: `dubbed:''` è il normale, `dubbed:'1'` sono le
  // schede doppiate in italiano (1.541 il 4/11, 0 slug in comune su un campione
  // di 30). Senza il secondo pass le ITA dedicate non entrano nel catalogo.
  for (const dubbed of ['', '1']) {
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
          title: '', type: '', year: '', order: '', status: '', genres: [], dubbed, season: '',
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
    if (offset < total) capped = true;
  }
  return { entries, capped };
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
      world: Number(process.env.CATALOG_WORLD_MAX_PAGES) || 300,
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
  const failures: string[] = [];

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
      // Un sito bloccato non ferma gli altri (host diversi): il suo catalogo
      // resta quello di ieri, gli altri si aggiornano e il job esce rosso.
      const message = `${site}: ${err instanceof BlockedError ? 'BLOCCATO' : 'errore'} — ${err?.message || err}`;
      console.error(`[catalog] ${message}; catalogo precedente mantenuto (${previous.sites[site].length} schede)`);
      catalog.sites[site] = previous.sites[site];
      if (previous.truncated[site]) catalog.truncated[site] = true;
      failures.push(message);
      continue;
    }
    const merged = mergeSite(site, previous.sites[site] || [], result.entries);
    if (!merged.accepted) {
      console.error(`[catalog] ${site}: ${merged.reason}`);
      catalog.sites[site] = previous.sites[site];
      if (previous.truncated[site]) catalog.truncated[site] = true;
      failures.push(merged.reason || `${site}: catalogo incompleto`);
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
  if (options.dryRun) {
    console.log(`[catalog] dry-run: ${total} schede, nessun file scritto (${elapsed}s)`);
    return failures.length ? 1 : 0;
  }
  // Si scrive anche con un sito fallito: i dati buoni degli altri non vanno persi.
  catalog.generatedAt = new Date().toISOString();
  writeCatalogsAtomic(options.dataDir, catalog, buildTitleIndex(catalog));
  const rel = path.relative(process.cwd(), options.dataDir) || '.';
  console.log(`[catalog] ${total} schede in ${elapsed}s -> ${rel}/catalogs.json, ${rel}/catalog-titles.json`);
  if (failures.length) {
    console.error(`[catalog] ${failures.length} siti falliti (catalogo di ieri), gli altri sono aggiornati: ${failures.join('; ')}`);
    return 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`[catalog] errore fatale: ${err?.message || err}`);
    process.exit(1);
  }
);
