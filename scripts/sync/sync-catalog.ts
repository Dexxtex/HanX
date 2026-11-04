#!/usr/bin/env node
/**
 * Catalogo locale AnimeSaturn / AnimeWorld / AnimeUnity.
 *
 * Budget di rete (dichiarato prima delle richieste, regole in AGENTS.md):
 * - una richiesta alla volta, 3 s tra la fine di una e l'inizio della successiva;
 * - timeout 15 s, User-Agent esplicito, 2 retry con backoff solo su 5xx/rete;
 * - 403 e 429 fermano tutto: il WAF si prolunga se si insiste;
 * - tetti giornalieri: Saturn 2 richieste di sitemap + ~206 pagine di listing (una
 *   partizione per tipo), World fino alle pagine
 *   dichiarate dal sito (172 oggi, 40 schede) con tetto 300, Unity 1 + 300
 *   pagine (30 schede). Totale massimo ~545, ~29 minuti; il tetto di World è
 *   solo una sicurezza, `truncated` scatta se il dichiarato lo supera.
 *
 * Uso: pnpm run sync-catalog [-- --site unity --max-pages 2 --dry-run]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetch as undiciFetch } from 'undici';
import { confirmMalIds } from '../../src/catalog/anilist.js';
import { proxyDispatcher, redactProxy } from '../../src/catalog/proxy.js';
import {
  CATALOG_SITES,
  buildTitleIndex,
  diffEntries,
  emptyCatalog,
  mergeSite,
  parseSaturnAnimeSitemap,
  parseSaturnFilterPage,
  parseSaturnSitemapIndex,
  applyCardDetails,
  isEnrichmentFinal,
  parseCardDetails,
  pendingEnrichment,
  saturnListingGap,
  SATURN_TYPES,
  parseWorldMaxPage,
  parseUnityRecords,
  parseWorldFilterPage,
  readCatalog,
  writeCatalogsAtomic,
  type CatalogEntry,
  type CatalogFile,
  type CatalogSite,
} from '../../src/catalog/sync.js';

const DATA_DIR = path.resolve(fileURLToPath(new URL('../../data', import.meta.url)));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const TIMEOUT_MS = Number(process.env.CATALOG_TIMEOUT_MS) || 15_000;
const INTERVAL_MS = Math.max(3_000, Number(process.env.CATALOG_INTERVAL_MS) || 3_000);
const RETRIES = 2;
const BACKOFF_MS = [1_500, 4_000];

/**
 * Proxy per l'intero crawl (IP residenziale): http(s) o socks5, gestiti da
 * undici. Un solo IP per tutta la run, altrimenti il cookie di sessione di
 * Unity si rompe: se il pool ruota, chiedere una sessione sticky. Non è un fix
 * del WAF, è un cambio di IP.
 */
const PROXY = String(process.env.CATALOG_PROXY || process.env.AU_PROXY || '').trim();
const DISPATCHER = proxyDispatcher(PROXY);

/** `fetch failed` da solo non dice niente: la causa (ECONNREFUSED, 407, DNS) sta in err.cause. */
function describeError(err: any): string {
  const cause = err?.cause?.message || err?.cause?.code || '';
  return redactProxy(`${err?.message || err}${cause ? ` (${cause})` : ''}`);
}

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

/** Tetto del walk di /filter: 206 pagine reali, il resto è margine, non un piano. */
const SATURN_WALK_BUDGET = 260;

async function crawlSaturn(maxPages: number): Promise<CrawlResult> {
  const index = await request(`${BASES.saturn}/sitemap.xml`);
  const parts = parseSaturnSitemapIndex(index.body);
  if (!parts.length) throw new Error('sitemap index senza parti /sitemap-anime-*.xml');
  // La sitemap resta la spina (2 richieste): le schede sono quelle, il listing
  // aggiunge titolo vero, data e tipo senza poterle perdere.
  const bySlug = new Map<string, CatalogEntry>();
  for (const part of parts.slice(0, maxPages)) {
    for (const entry of parseSaturnAnimeSitemap((await request(part)).body)) bySlug.set(entry.slug, entry);
  }
  const spine = bySlug.size;
  // Una partizione di tipo per giro: le pagine in totale restano ~206, e il tipo
  // arriva dal filtro invece di essere dedotto. Titolo e data sono in ogni card.
  let budget = SATURN_WALK_BUDGET;
  let walked = 0;
  // Il walk è arrivato in fondo (pagina vuota) o è stato tagliato da tetto/budget?
  let truncatedByCap = false;
  // Slug distinti arricchiti: una scheda può comparire in due partizioni di tipo.
  const enriched = new Set<string>();
  for (const type of SATURN_TYPES) {
    let closed = false;
    for (let page = 1; page <= maxPages && budget > 0; page += 1) {
      budget -= 1;
      walked += 1;
      const url = `${BASES.saturn}/filter?types%5B%5D=${encodeURIComponent(type)}&page=${page}`;
      const found = parseSaturnFilterPage((await request(url)).body, type);
      if (!found.length) {
        closed = true;
        break;
      }
      for (const entry of found) {
        const known = bySlug.get(entry.slug);
        if (!known) {
          bySlug.set(entry.slug, entry);
          enriched.add(entry.slug);
          continue;
        }
        Object.assign(known, {
          titleSite: entry.titleSite,
          ...(entry.startDate ? { startDate: entry.startDate } : {}),
          ...(entry.episodes ? { episodes: entry.episodes } : {}),
          ...(entry.type ? { type: entry.type } : {}),
        });
        enriched.add(entry.slug);
      }
    }
    if (!closed) truncatedByCap = true;
  }
  console.log(`[catalog] saturn: ${bySlug.size} schede, ${enriched.size}/${spine} arricchite dal listing (${walked} pagine)`);
  // Solo su un walk completo: con --max-pages o budget esaurito la copertura
  // parziale è voluta e non va segnalata come guasto.
  if (!truncatedByCap) {
    const gap = saturnListingGap(enriched.size, spine);
    if (gap) throw new Error(gap);
  }
  return { entries: [...bySlug.values()], capped: parts.length > maxPages || budget === 0 };
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

/** Schede a cui prendere il malId per run: 300 richieste ≈ 15 min a 3 s. */
const MALID_MAX_REQUESTS = Number(process.env.CATALOG_MALID_MAX_REQUESTS) || 300;
/** Oltre questo minuto dall'avvio la fase si ferma: il job ha 60 min di tetto. */
const MALID_DEADLINE_MIN = Number(process.env.CATALOG_MALID_DEADLINE_MIN) || 52;

/**
 * Backfill del `malId` dalle pagine delle schede, una richiesta per scheda: 6.179
 * Saturn + 6.864 World, quindi si fa a rate e si riprende dalla sera dopo. Le
 * schede nuove passano davanti al backlog; i dati già presi restano (mergeSite).
 * Restituisce le schede lette e quante c'erano da leggere: zero lette su un
 * backlog non vuoto è un blocco o una deadline già scaduta.
 */
async function enrichMalIds(
  catalog: CatalogFile,
  startedAt: number
): Promise<{ read: number; pending: number }> {
  const deadline = startedAt + MALID_DEADLINE_MIN * 60_000;
  const quota = Math.ceil(MALID_MAX_REQUESTS / 2);
  const today = new Date().toISOString().slice(0, 10);
  let cardsRead = 0;
  // Il backlog si conta su entrambi i siti **prima** del ciclo: se la deadline
  // scade dopo Saturn, il backlog di World non deve sparire dai conti (era il
  // caso in cui la guardia taceva proprio quando serviva).
  const pendingBySite = {
    saturn: pendingEnrichment(catalog.sites.saturn, today),
    world: pendingEnrichment(catalog.sites.world, today),
  };
  const cardsPending = pendingBySite.saturn.length + pendingBySite.world.length;
  for (const site of ['saturn', 'world'] as const) {
    const entries = catalog.sites[site];
    // Prima le schede mai lette (le nuove comprese), poi le più vecchie: quelle
    // lette da poco non si rileggono, altrimenti le schede senza id AniList
    // brucerebbero la quota a ogni run.
    const pending = pendingBySite[site];
    const found: { entry: CatalogEntry; details: ReturnType<typeof parseCardDetails> }[] = [];
    let requests = 0;
    for (const entry of pending) {
      if (requests >= quota || Date.now() > deadline) break;
      requests += 1;
      try {
        found.push({ entry, details: parseCardDetails((await request(entry.url)).body, site) });
      } catch (err) {
        // Mezzo backfill vale più di un job rosso: la fase si chiude e si riprende domani.
        console.error(`[catalog] malId ${site}: ${err instanceof BlockedError ? 'BLOCCATO' : 'errore'} — ${describeError(err)}`);
        break;
      }
    }
    // Solo gli id che AniList conferma: una pagina con il link MAL sbagliato non
    // deve entrare nel ramo esatto del matcher. `answered` dice per quali schede
    // ha risposto davvero, anche quando la risposta è un no.
    cardsRead += found.length;
    const { confirmed, answered } = await confirmMalIds(found.map((item) => item.details));
    let accepted = 0;
    let rejected = 0;
    let unanswered = 0;
    let skipped = 0;
    let aliased = 0;
    for (const { entry, details } of found) {
      // Tutto il resto della scheda si salva comunque: sono dati del sito, non
      // id di altri cataloghi. Solo il malId ha bisogno di conferma.
      const aliasesBefore = entry.titles?.length || 0;
      applyCardDetails(entry, details, confirmed);
      const answer = details.anilistId ? answered.has(details.anilistId) : false;
      if (!details.malId || !details.anilistId) skipped += 1;
      else if (!answer) unanswered += 1;
      else if (confirmed.get(details.anilistId) === details.malId) accepted += 1;
      else rejected += 1;
      if ((entry.titles?.length || 0) > aliasesBefore) aliased += 1;
      // `enrichedAt` solo per un esito definitivo: la scheda senza link MAL o
      // senza link AniList non ha niente da confermare, quella muta si riprova.
      if (isEnrichmentFinal(details, answered)) entry.enrichedAt = today;
    }
    const withMalId = entries.filter((entry) => entry.malId).length;
    console.log(
      `[catalog] schede ${site}: ${found.length} lette, ${accepted} malId confermati, ${rejected} rifiutati, ` +
        `${unanswered} in attesa di AniList, ${skipped} senza id da confermare, ${aliased} con alias nuovi ` +
        `(${withMalId}/${entries.length} con malId)`
    );
    if (Date.now() > deadline) break;
  }
  return { read: cardsRead, pending: cardsPending };
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
  /** Solo arricchimento del catalogo già presente: nessun crawl. */
  enrichOnly: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    sites: [...CATALOG_SITES],
    maxPages: {
      saturn: 260,
      world: Number(process.env.CATALOG_WORLD_MAX_PAGES) || 300,
      unity: Number(process.env.CATALOG_UNITY_MAX_PAGES) || 300,
    },
    dryRun: false,
    dataDir: DATA_DIR,
    enrichOnly: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--enrich-only') options.enrichOnly = true;
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
  const startedAt0 = Date.now();

  // Modalità del workflow "Catalog Enrichment": i cataloghi sono già pubblicati,
  // si leggono solo le schede da arricchire. Nessun crawl, nessun rischio di
  // pubblicare un catalogo peggiore.
  if (options.enrichOnly) {
    const sites = (['saturn', 'world'] as const).filter((site) => previous.sites[site].length > 0);
    if (!sites.length) {
      console.error('[catalog] niente da arricchire: il catalogo locale è vuoto (serve una run di sync)');
      return 1;
    }
    const { read, pending } = await enrichMalIds(previous, startedAt0);
    if (!read && pending) {
      // Nessuna scheda letta su un backlog non vuoto: WAF o deadline già scaduta.
      // Verde qui vorrebbe dire "arricchimento fatto" mentre non è stato letto niente.
      console.error(`[catalog] nessuna scheda letta su ${pending} da leggere: il catalogo resta com'era`);
      return 1;
    }
    if (options.dryRun) {
      console.log('[catalog] dry-run: nessun file scritto');
      return 0;
    }
    previous.generatedAt = new Date().toISOString();
    writeCatalogsAtomic(options.dataDir, previous, buildTitleIndex(previous));
    console.log(`[catalog] arricchito in ${((Date.now() - startedAt0) / 1000).toFixed(1)}s`);
    return 0;
  }
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
      const message = `${site}: ${err instanceof BlockedError ? 'BLOCCATO' : 'errore'} — ${describeError(err)}`;
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
  // Solo con la rete libera: dopo i tre crawl, con il tempo che resta.
  if (options.sites.includes('saturn') || options.sites.includes('world')) {
    const { read, pending } = await enrichMalIds(catalog, startedAt);
    // Stessa regola di `--enrich-only`: niente letto su un backlog non vuoto
    // vuol dire WAF o deadline già scaduta, non "arricchimento fatto".
    if (pending > 0 && read === 0) {
      const message = `arricchimento: nessuna scheda letta su ${pending} da leggere`;
      console.error(`[catalog] ${message}`);
      failures.push(message);
    }
  }

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
    console.error(`[catalog] ${failures.length} problemi, run incompleta: ${failures.join('; ')}`);
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
