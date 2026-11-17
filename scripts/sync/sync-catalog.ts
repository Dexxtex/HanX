#!/usr/bin/env node
/**
 * Catalogo locale AnimeSaturn / AnimeWorld / AnimeUnity.
 *
 * Budget di rete (dichiarato prima delle richieste, regole in AGENTS.md):
 * - una richiesta alla volta **per host**, `CATALOG_INTERVAL_MS` tra la fine di
 *   una e l'inizio della successiva (pavimento 125 ms = 8 req/s, il massimo
 *   misurato sui tre siti). Lo slot è per host: i tre siti possono procedere
 *   insieme e ognuno vede comunque una richiesta per intervallo;
 * - timeout 15 s, User-Agent esplicito, 2 retry con backoff solo su 5xx/rete;
 * - 403 ferma tutto subito; 429 fa **una** attesa di 60 s e un retry, poi ferma
 *   tutto (regola di AGENTS.md: un rate-limit transitorio non è un WAF);
 * - tetti per sito: Saturn 2 sitemap + 260 pagine, World 300, Unity 300 (ne
 *   servono 212: 2 sitemap + 210 pagine da 30 schede). Il tetto vero però è la
 *   deadline del crawl (34 minuti), quindi i cap delle pagine sono una sicurezza
 *   e non la pianificazione. L'arricchimento ha una deadline propria (52 minuti)
 *   e un tetto per run. `truncated` dice quale sito è stato tagliato.
 *
 * Uso: pnpm run sync-catalog [-- --site unity --max-pages 2 --dry-run]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetch as undiciFetch } from 'undici';
import { enrichMalIds as enrichMalIdsImpl, enrichmentStalled } from '../../src/catalog/enrich.js';
import { proxyDispatcher, redactProxy } from '../../src/catalog/proxy.js';
import {
  CATALOG_SITES,
  buildTitleIndex,
  diffEntries,
  emptyCatalog,
  mergeSite,
  applyCardDetails,
  parseCardDetails,
  parseAnimeSitemap,
  parseAnimeSitemapIndex,
  WORLD_URL_TOKEN,
  parseWorldMaxPage,
  parseUnityRecords,
  parseWorldFilterPage,
  applyWorldUpdates,
  readCatalog,
  writeCatalogsAtomic,
  type CatalogEntry,
  type CatalogFile,
  type CatalogSite,
} from '../../src/catalog/sync.js';

const DATA_DIR = path.resolve(fileURLToPath(new URL('../../data', import.meta.url)));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const TIMEOUT_MS = Number(process.env.CATALOG_TIMEOUT_MS) || 15_000;
/**
 * Intervallo per host. Il pavimento e' 125 ms (8 req/s), il massimo misurato su
 * tutti e tre i siti; il default resta prudente per chi non passa la variabile.
 */
const INTERVAL_MS = Math.max(125, Number(process.env.CATALOG_INTERVAL_MS) || 3_000);
const RETRIES = 2;
const BACKOFF_MS = [1_500, 4_000];

/**
 * Proxy per l'intero crawl (IP residenziale): http(s) o socks5, gestiti da
 * undici. Un solo IP per tutta la run, altrimenti un pool che ruota cambia
 * indirizzo a metà crawl: se ruota, chiedere una sessione sticky. Non è un fix
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
  unity: 'https://animeunity.cx',
} as const;

class BlockedError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Uno slot per host, non uno globale: Saturn, World e Unity sono host diversi e
 * con lo slot unico due siti restavano fermi mentre il terzo lavorava. Il rate
 * che ogni sito vede non cambia (uno ogni INTERVAL_MS), cambia solo che i tre
 * possono procedere insieme.
 */
const nextSlotByHost = new Map<string, number>();

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Legge il corpo fermandosi a `maxBytes`. Serve alle schede di Saturn: gli id
 * stanno in `div.ag-links`, che finisce fra 28.618 e 29.520 byte su 10 schede
 * da 82 KB a 650 KB — il resto e' la lista episodi.
 */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size >= maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Una richiesta alla volta, con lo slot successivo calcolato dalla fine della precedente. */
async function request(url: string, init: RequestInit = {}, maxBytes = 0): Promise<{ body: string; headers: Headers }> {
  const host = hostOf(url);
  for (let attempt = 0; ; attempt += 1) {
    const wait = (nextSlotByHost.get(host) ?? 0) - Date.now();
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
      // Slot consumato all'arrivo degli header: copre anche i rami d'errore,
      // che altrimenti farebbero ripartire il retry prima dell'intervallo.
      nextSlotByHost.set(host, Date.now() + INTERVAL_MS);
    }
    if (response.status === 403) {
      throw new BlockedError(`403 su ${url}`);
    }
    if (response.status === 429) {
      // Una sola attesa di 60 s e un retry, poi stop: un 429 transitorio non è
      // un WAF e non deve far saltare la notte a quel sito.
      // `RETRIES` vale 2, quindi `attempt < RETRIES` darebbe DUE attese: la
      // regola è una sola attesa e un retry.
      if (attempt === 0) {
        await sleep(60_000);
        continue;
      }
      throw new BlockedError(`429 su ${url} dopo ${attempt + 1} tentativi`);
    }
    if (response.status >= 500 && attempt < RETRIES) {
      await sleep(BACKOFF_MS[attempt]);
      continue;
    }
    if (!response.ok) throw new Error(`${response.status} su ${url}`);
    const body = maxBytes ? await readCapped(response, maxBytes) : await response.text();
    // Ricalcolato a fine corpo: prima restava fissato agli header, quindi il gap
    // reale era header→header e la pagina lenta accorciava il pacing.
    nextSlotByHost.set(host, Date.now() + INTERVAL_MS);
    return { body, headers: response.headers };
  }
}

interface CrawlResult {
  entries: CatalogEntry[];
  /** Il tetto di pagine ha troncato il catalogo: va detto, non nascosto. */
  capped: boolean;
}

/** Il titolo vero della scheda: lo slug non lo contiene. */
function jsonLdTitle(html: string): string {
  const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  if (!raw) return '';
  try {
    return String(JSON.parse(raw).name || '').trim();
  } catch {
    return '';
  }
}

/** Oltre questo l'abort ha tagliato prima di `div.ag-links`: si rilegge intera. */
const SATURN_CARD_BYTES = 32 * 1024;

async function crawlSaturn(maxPages: number, deadline: number, previous: CatalogEntry[] = []): Promise<CrawlResult> {
  const index = await request(`${BASES.saturn}/sitemap.xml`);
  const parts = parseAnimeSitemapIndex(index.body);
  if (!parts.length) throw new Error('sitemap index senza parti /sitemap-anime-*.xml');
  // La sitemap resta la spina (2 richieste): le schede sono quelle, il listing
  // aggiunge titolo vero, data e tipo senza poterle perdere.
  const bySlug = new Map<string, CatalogEntry>();
  for (const part of parts.slice(0, maxPages)) {
    for (const entry of parseAnimeSitemap((await request(part)).body)) bySlug.set(entry.slug, entry);
  }
  const spine = bySlug.size;

  // DELTA: la sitemap dichiara `<lastmod>` per scheda. Se il catalogo di ieri ha
  // la stessa data, la scheda non e' cambiata e si tiene quella (zero richieste).
  // Cambiate e nuove si leggono qui, con l'abort a 32 KB; quelle gia' arricchite
  // non hanno `enrichedAt`, quindi l'arricchimento le riprende e conferma gli id.
  // Senza catalogo di ieri (primo giro) o senza date si fa il crawl pieno.
  const prevBySlug = new Map(previous.map((entry) => [entry.slug, entry]));
  const delta = previous.length > 0 && [...bySlug.values()].some((entry) => entry.lastmod);
  if (delta) {
    const toRead: CatalogEntry[] = [];
    for (const item of bySlug.values()) {
      const old = prevBySlug.get(item.slug);
      // `===` anche quando la data manca da entrambe le parti: le 7 schede senza
      // `<lastmod>` nella sitemap non vanno rilette ogni notte.
      if (old && old.lastmod === item.lastmod) {
        bySlug.set(item.slug, old);
        continue;
      }
      toRead.push(item);
    }
    let read = 0;
    let full = 0;
    for (const item of toRead) {
      if (Date.now() >= deadline) break;
      const old = prevBySlug.get(item.slug);
      let body = (await request(item.url, {}, SATURN_CARD_BYTES)).body;
      if (!body.includes('myanimelist.net/anime/')) {
        body = (await request(item.url)).body;
        full += 1;
      }
      const details = parseCardDetails(body, 'saturn');
      const entry: CatalogEntry = {
        ...(old || {}),
        site: 'saturn',
        slug: item.slug,
        url: item.url,
        titleSite: jsonLdTitle(body) || old?.titleSite || item.titleSite,
        ...(item.lastmod ? { lastmod: item.lastmod } : {}),
      };
      // `malId` non si scrive senza la conferma di AniList: la fa l'arricchimento.
      applyCardDetails(entry, details, new Map());
      bySlug.set(item.slug, entry);
      read += 1;
    }
    console.log(
      `[catalog] saturn: ${bySlug.size} schede, ${bySlug.size - read} invariate (lastmod), ` +
        `${read} rilette (${full} intere), ${toRead.length - read} oltre la deadline`
    );
    return { entries: [...bySlug.values()], capped: parts.length > maxPages || read < toRead.length };
  }
  // Il walk su /filter e' stato tolto: il sito e' passato a una pagina Alpine che
  // non contiene i risultati (il parser cercava `a.ac`, che non esiste piu'), e
  // per ognuna delle 5 partizioni la prima pagina era vuota. Il tipo arriva dal
  // badge della scheda (parseCardDetails), non dal listing.
  console.log(`[catalog] saturn: ${bySlug.size} schede dalla sitemap`);
  return { entries: [...bySlug.values()], capped: parts.length > maxPages };
}

/**
 * `/updated` è ordinato per ultimo aggiornamento decrescente e porta `Ep N`:
 * una scheda il cui episodio non è più alto di quello che il catalogo già ha
 * non è cambiata. Si scende finché una pagina intera non porta niente di nuovo.
 * `maxPages` qui è un tetto di sicurezza: 20 pagine sono 800 card, ~100 s.
 */
// World non espone una data per scheda (la sitemap ha una data sola per tutti i
// ~50k URL, /updated non porta date): l'unico segnale e' l'ordine. Misurato il
// 13/11: ~1.295 schede toccate al giorno, quindi 20 pagine (800) coprivano ~14
// ore e il job gira ogni 24. 40 pagine = 1.600 schede, ~30 ore.
const WORLD_UPDATED_MAX_PAGES = 40;

async function crawlWorldDelta(deadline: number, previous: CatalogEntry[]): Promise<CrawlResult> {
  const bySlug = new Map(previous.map((entry) => [entry.slug, entry]));
  let pages = 0;
  let changed = 0;
  for (let page = 1; page <= WORLD_UPDATED_MAX_PAGES && Date.now() < deadline; page += 1) {
    const cards = parseWorldFilterPage((await request(`${BASES.world}/updated?page=${page}`)).body, true);
    if (!cards.length) break;
    pages += 1;
    const fresh = applyWorldUpdates(bySlug, cards);
    changed += fresh;
    // Una pagina senza niente di nuovo: sotto c'è solo roba più vecchia.
    if (!fresh) break;
  }
  console.log(`[catalog] world: /updated ${pages} pagine, ${changed} schede cambiate`);
  return { entries: [...bySlug.values()], capped: false };
}

/**
 * Il tipo di World non e' nella scheda: lo dichiara il listato per tipo. Si
 * annota la scheda che il catalogo gia' conosce, senza aggiungerne di nuove.
 * 172 pagine in tutto, e il numero e' dichiarato in `paginationMaxPage`.
 */
const WORLD_TYPE_LISTINGS: [string, string][] = [
  ['/animes', 'TV'], ['/movies', 'Movie'], ['/ova', 'OVA'], ['/ona', 'ONA'], ['/specials', 'Special'],
];

async function tagWorldTypes(bySlug: Map<string, CatalogEntry>, deadline: number): Promise<number> {
  // Le schede scritte prima del fix del token hanno lo slug col punto
  // (`sword-art-online-2.cdkvda`): il listato lo da' senza, quindi si confronta
  // sulla forma normalizzata. Senza collisioni (verificato: 0 su 1.165).
  const byBase = new Map<string, CatalogEntry>();
  for (const entry of bySlug.values()) byBase.set(entry.slug.replace(WORLD_URL_TOKEN, ''), entry);
  let tagged = 0;
  for (const [path, name] of WORLD_TYPE_LISTINGS) {
    let lastPage: number | null = null;
    for (let page = 1; page <= 200 && Date.now() < deadline; page += 1) {
      if (lastPage !== null && page > lastPage) break;
      const html = (await request(`${BASES.world}${path}?page=${page}`)).body;
      if (page === 1) lastPage = parseWorldMaxPage(html);
      const cards = parseWorldFilterPage(html);
      if (!cards.length) break;
      for (const card of cards) {
        const entry = byBase.get(card.slug);
        if (!entry || entry.type === name) continue;
        entry.type = name;
        tagged += 1;
      }
    }
  }
  return tagged;
}

async function crawlWorld(maxPages: number, deadline: number, previous: CatalogEntry[] = []): Promise<CrawlResult> {
  // Senza catalogo di ieri il delta non ha una spina dorsale: si cammina /filter.
  if (previous.length) {
    const result = await crawlWorldDelta(deadline, previous);
    const bySlug = new Map(result.entries.map((entry) => [entry.slug, entry]));
    const tagged = await tagWorldTypes(bySlug, deadline);
    if (tagged) console.log(`[catalog] world: ${tagged} schede tipizzate dal listato`);
    return { entries: [...bySlug.values()], capped: result.capped };
  }
  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();
  let declared: number | null = null;
  for (let page = 1; page <= (declared === null ? maxPages : Math.min(maxPages, declared)) && Date.now() < deadline; page += 1) {
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
  // Troncato se il dichiarato supera il tetto, se il numero non è dichiarato,
  // o se il tappo di tempo ha fermato il walk prima della fine.
  const bySlug = new Map(entries.map((entry) => [entry.slug, entry]));
  const tagged = await tagWorldTypes(bySlug, deadline);
  if (tagged) console.log(`[catalog] world: ${tagged} schede tipizzate dal listato`);
  const ranOutOfTime = Date.now() >= deadline;
  return { entries: [...bySlug.values()], capped: declared === null || declared > maxPages || ranOutOfTime };
}

/**
 * AnimeUnity non dichiara una data per scheda nell'archivio, ma la sitemap sì:
 * due richieste dicono se qualcosa è cambiato, e solo allora si rilegge
 * l'archivio paginato (30 schede per risposta, ~41 KB).
 */
async function crawlUnity(maxPages: number, deadline: number, previous: CatalogEntry[] = []): Promise<CrawlResult> {
  const index = await request(`${BASES.unity}/sitemap.xml`);
  const parts = parseAnimeSitemapIndex(index.body);
  if (!parts.length) throw new Error('sitemap index senza parti anime-*.xml');
  const spine = new Map<string, CatalogEntry>();
  for (const part of parts.slice(0, maxPages)) {
    for (const entry of parseAnimeSitemap((await request(part)).body, 'unity')) spine.set(entry.slug, entry);
  }
  const newest = [...spine.values()].reduce(
    (max, entry) => (entry.lastmod && entry.lastmod > max ? entry.lastmod : max),
    ''
  );
  const stored = previous.reduce(
    (max, entry) => (entry.lastmod && entry.lastmod > max ? entry.lastmod : max),
    ''
  );

  const first = parseUnityRecords(JSON.parse((await request(`${BASES.unity}/api/archive?page=1`)).body));
  const total = first.total || Number.POSITIVE_INFINITY;
  // DELTA: aggiunte e modifiche alzano una `lastmod` nella sitemap, le rimozioni
  // cambiano il conteggio del sito. Se nessuna delle due è successa, il catalogo
  // di ieri vale e i 209 chunk restanti non possono portare niente di nuovo.
  if (previous.length === total && stored && newest <= stored) {
    console.log(`[catalog] unity: ${total} schede, nessuna lastmod nuova`);
    return { entries: previous, capped: false };
  }

  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();
  const keep = (list: CatalogEntry[]): void => {
    for (const entry of list) {
      if (seen.has(entry.slug)) continue;
      seen.add(entry.slug);
      // La data della sitemap è il perno del delta: si porta sulla scheda.
      const lastmod = spine.get(entry.slug)?.lastmod;
      entries.push(lastmod ? { ...entry, lastmod } : entry);
    }
  };
  keep(first.entries);
  for (let page = 2; page <= maxPages && Date.now() < deadline && entries.length < total; page += 1) {
    const parsed = parseUnityRecords(JSON.parse((await request(`${BASES.unity}/api/archive?page=${page}`)).body));
    if (!parsed.entries.length) break;
    keep(parsed.entries);
  }
  return { entries, capped: entries.length < total || Date.now() >= deadline };
}

/** Schede a cui prendere il malId per run: 650 a 125 ms sono ~2 min, il resto è latenza. */
const MALID_MAX_REQUESTS = Number(process.env.CATALOG_MALID_MAX_REQUESTS) || 300;
/** Oltre questo minuto dall'avvio l'arricchimento si ferma: il job ha 60 min di tetto. */
const MALID_DEADLINE_MIN = Number(process.env.CATALOG_MALID_DEADLINE_MIN) || 52;
/**
 * Oltre questo minuto il crawl si ferma, anche a metà sito: il tempo che resta
 * è dell'arricchimento, che è quello che riempie i dati mancanti. Senza tappo
 * il crawl dei tre siti si mangiava 37 minuti su 52 per trovare ~2 schede nuove.
 */
const CRAWL_DEADLINE_MIN = Number(process.env.CATALOG_CRAWL_DEADLINE_MIN) || 34;
/**
 * Un sito per notte. Il crawl completo dei tre costa ~37 minuti su 52 per
 * trovare ~2 schede nuove, mentre l'arricchimento — che riempie gli id episodio
 * e i malId — resta a secco. A rotazione ogni sito si riallinea ogni tre
 * giorni: il catalogo è un'accelerazione, non la fonte di verità, quindi una
 * scheda nuova che arriva con due giorni di ritardo costa una ricerca di rete.
 */
const CRAWL_ROTATION: CatalogSite[] = ['saturn', 'world', 'unity'];

/**
 * Wrapper di I/O per l'arricchimento: la logica sta in `src/catalog/enrich.ts`
 * (testata e type-checked), qui solo la rete con il budget e il pacing del sync.
 */
function enrichMalIds(catalog: CatalogFile, startedAt: number) {
  return enrichMalIdsImpl(catalog, {
    readPage: async (entry) => (await request(entry.url)).body,
    isBlocked: (err) => err instanceof BlockedError,
    // Il budget si divide fra i due siti che restano: Unity non si arricchisce
    // più, i suoi id arrivano dal crawl.
    quota: Math.ceil(MALID_MAX_REQUESTS / 2),
    deadline: startedAt + MALID_DEADLINE_MIN * 60_000,
    describe: describeError,
    log: (line) => console.log(line),
  });
}

const CRAWLERS: Record<CatalogSite, (maxPages: number, deadline: number, previous: CatalogEntry[]) => Promise<CrawlResult>> = {
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
  /** Crawl di tutti i siti in una run, invece della rotazione di uno per notte. */
  allSites: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    sites: [...CATALOG_SITES],
    maxPages: {
      saturn: Number(process.env.CATALOG_SATURN_MAX_PAGES) || 260,
      world: Number(process.env.CATALOG_WORLD_MAX_PAGES) || 300,
      unity: Number(process.env.CATALOG_UNITY_MAX_PAGES) || 300,
    },
    dryRun: false,
    dataDir: DATA_DIR,
    enrichOnly: false,
    allSites: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--enrich-only') options.enrichOnly = true;
    else if (arg === '--all') options.allSites = true;
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
    const result = await enrichMalIds(previous, startedAt0);
    const { pending } = result;
    if (enrichmentStalled(result)) {
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
  const crawlDeadline = startedAt + CRAWL_DEADLINE_MIN * 60_000;
  // `--all` o `--site` espliciti vincono; altrimenti un sito per notte.
  const crawlSites: CatalogSite[] =
    options.allSites || options.sites.length === 1
      ? options.sites
      : [CRAWL_ROTATION[Math.floor(Date.now() / 86_400_000) % CRAWL_ROTATION.length]];
  if (crawlSites.length < CATALOG_SITES.length) {
    console.log(`[catalog] rotazione: stanotte si aggiorna ${crawlSites.join(', ')}`);
  }

  // I tre siti insieme: sono host diversi e il pacing e' per host, quindi in
  // fila due siti restavano fermi mentre il terzo lavorava. La run dura il sito
  // piu' lungo, e un sito bloccato non ferma gli altri.
  await Promise.all(
    CATALOG_SITES.map(async (site) => {
      if (!crawlSites.includes(site)) {
        catalog.sites[site] = previous.sites[site];
        if (previous.truncated[site]) catalog.truncated[site] = true;
        return;
      }
      const siteStart = Date.now();
      let result: CrawlResult;
      try {
        result = await CRAWLERS[site](options.maxPages[site], crawlDeadline, previous.sites[site] || []);
      } catch (err: any) {
        // Un sito bloccato non ferma gli altri (host diversi): il suo catalogo
        // resta quello di ieri, gli altri si aggiornano e il job esce rosso.
        const message = `${site}: ${err instanceof BlockedError ? 'BLOCCATO' : 'errore'} — ${describeError(err)}`;
        console.error(`[catalog] ${message}; catalogo precedente mantenuto (${previous.sites[site].length} schede)`);
        catalog.sites[site] = previous.sites[site];
        if (previous.truncated[site]) catalog.truncated[site] = true;
        failures.push(message);
        return;
      }
      const merged = mergeSite(site, previous.sites[site] || [], result.entries);
      if (!merged.accepted) {
        console.error(`[catalog] ${site}: ${merged.reason}`);
        catalog.sites[site] = previous.sites[site];
        if (previous.truncated[site]) catalog.truncated[site] = true;
        failures.push(merged.reason || `${site}: catalogo incompleto`);
        return;
      }
      const diff = diffEntries(previous.sites[site] || [], merged.entries);
      catalog.sites[site] = merged.entries;
      if (result.capped) catalog.truncated[site] = true;
      const capped = result.capped ? ` (tetto ${options.maxPages[site]} pagine raggiunto)` : '';
      console.log(
        `[catalog] ${site.padEnd(6)} ${String(merged.entries.length).padStart(6)} schede  ` +
          `+${diff.added}/-${diff.removed}  ${((Date.now() - siteStart) / 1000).toFixed(1)}s${capped}`
      );
    })
  );

  const total = CATALOG_SITES.reduce((sum, site) => sum + catalog.sites[site].length, 0);
  // Sempre: il catalogo contiene tutti i siti (quelli non crawlerati stanotte
  // restano a ieri), e l'arricchimento è la parte che riempie i dati mancanti.
  const enriched = await enrichMalIds(catalog, startedAt);
  // Stessa regola di `--enrich-only`: niente letto su un backlog non vuoto
  // vuol dire WAF o deadline già scaduta, non "arricchimento fatto".
  if (enrichmentStalled(enriched)) {
    const { pending } = enriched;
    const message = `arricchimento: nessuna scheda letta su ${pending} da leggere`;
    console.error(`[catalog] ${message}`);
    failures.push(message);
  }
  // Il tempo si conta dopo l'arricchimento: prima diceva 45 s su una run da 90.
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

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
