#!/usr/bin/env node
/**
 * Catalogo locale AnimeSaturn / AnimeWorld / AnimeUnity.
 *
 * Budget di rete (dichiarato prima delle richieste, regole in AGENTS.md):
 * - una richiesta alla volta **per host**, 3 s tra la fine di una e l'inizio
 *   della successiva (`CATALOG_INTERVAL_MS`, pavimento 1 s: è la tariffa
 *   misurata sicura). Lo slot è per host: i tre siti possono procedere insieme
 *   e ognuno vede comunque una richiesta ogni 3 s;
 * - timeout 15 s, User-Agent esplicito, 2 retry con backoff solo su 5xx/rete;
 * - 403 ferma tutto subito; 429 fa **una** attesa di 60 s e un retry, poi ferma
 *   tutto (regola di AGENTS.md: un rate-limit transitorio non è un WAF);
 * - tetti per sito: Saturn 2 sitemap + 260 pagine, World 300, Unity 300. Il
 *   tetto vero però è la deadline del crawl (34 minuti): a 3 s per richiesta
 *   sono ~680 richieste, quindi i cap delle pagine sono una sicurezza e non la
 *   pianificazione. L'arricchimento ha una deadline propria (52 minuti) e
 *   un tetto per run. `truncated` dice quale sito è stato tagliato.
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
  parseSaturnAnimeSitemap,
  parseSaturnSitemapIndex,
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
    rememberCookies(response.headers);
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
  const parts = parseSaturnSitemapIndex(index.body);
  if (!parts.length) throw new Error('sitemap index senza parti /sitemap-anime-*.xml');
  // La sitemap resta la spina (2 richieste): le schede sono quelle, il listing
  // aggiunge titolo vero, data e tipo senza poterle perdere.
  const bySlug = new Map<string, CatalogEntry>();
  for (const part of parts.slice(0, maxPages)) {
    for (const entry of parseSaturnAnimeSitemap((await request(part)).body)) bySlug.set(entry.slug, entry);
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
  return { entries: [...bySlug.values()], capped: parts.length > maxPages || truncatedByCap };
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

function csrfFrom(html: string): { xsrf: string; token: string } {
  const xsrf = decodeURIComponent(cookies.get('XSRF-TOKEN') || '');
  const token = html.match(/name="csrf-token"\s+content="([^"]+)"/)?.[1] || '';
  return { xsrf, token };
}

async function crawlUnity(maxPages: number, deadline: number, previous: CatalogEntry[] = []): Promise<CrawlResult> {
  // Il GET serve al token CSRF (Laravel) e fa da canary: i dati arrivano dal POST.
  const page = await request(`${BASES.unity}/archivio`);
  const { xsrf, token } = csrfFrom(page.body);
  if (!xsrf && !token) throw new Error('nessun token CSRF su /archivio');
  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  for (let chunk = 0; chunk < maxPages && offset < total && Date.now() < deadline; chunk += 1) {
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
    // `tot` è il numero di schede del sito: se è uguale a quante ne ha il
    // catalogo, la lista è la stessa e i 242 chunk restanti non possono portare
    // niente di nuovo. Cambia anche quando una scheda viene tolta, quindi non
    // si può restare indietro in silenzio.
    if (chunk === 0 && previous.length === total) {
      console.log(`[catalog] unity: tot ${total} invariato, nessun chunk da rileggere`);
      return { entries: previous, capped: false };
    }
    if (!parsed.entries.length) break;
    for (const entry of parsed.entries) {
      if (seen.has(entry.slug)) continue;
      seen.add(entry.slug);
      entries.push(entry);
    }
    offset += parsed.entries.length;
  }
  return { entries, capped: offset < total || Date.now() >= deadline };
}

/** Schede a cui prendere il malId per run: a 3,3 s di pacing, 650 ≈ 36 min. */
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
    // Unity: gli id episodio da `info_api` (3,8 KB) invece della scheda (~95 KB),
    // che si ferma comunque a 120 episodi. Gli altri campi di Unity arrivano da
    // `get-animes` e sono già nel catalogo.
    readEpisodes: async (entry) => {
      const animeId = Number(String(entry.slug || '').split('-')[0]);
      if (!animeId) return null;
      const total = Number(entry.episodes) || 0;
      const chunks = Math.min(10, Math.max(1, Math.ceil(total / 120)));
      const pairs: [number, number][] = [];
      const seen = new Set<number>();
      for (let chunk = 0; chunk < chunks; chunk += 1) {
        const start = chunk * 120 + 1;
        const response = await request(
          `${BASES.unity}/info_api/${animeId}/1?start_range=${start}&end_range=${start + 119}`,
          { headers: { 'x-requested-with': 'XMLHttpRequest', referer: `${BASES.unity}/` } }
        );
        const payload = JSON.parse(response.body) as { episodes?: { id?: number; number?: string }[] };
        const episodes = Array.isArray(payload?.episodes) ? payload.episodes : [];
        if (!episodes.length) break;
        for (const item of episodes) {
          const id = Number(item?.id);
          const num = Number(String(item?.number ?? '').match(/(\d{1,4})/)?.[1]);
          if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(num) || num <= 0 || seen.has(num)) continue;
          seen.add(num);
          pairs.push([num, id]);
        }
      }
      return pairs.length ? pairs.sort((a, b) => a[0] - b[0]) : null;
    },
    isBlocked: (err) => err instanceof BlockedError,
    // Il budget totale non cambia: meta' a Unity (id episodio), il resto diviso
    // tra saturn e world. Con 600 richieste a 3 s sono ~30 min, dentro la
    // deadline di 32: se il totale sfora, Unity si ferma senza fare progressi.
    quota: Math.ceil((MALID_MAX_REQUESTS - Math.ceil(MALID_MAX_REQUESTS / 2)) / 2),
    quotaBySite: { unity: Math.ceil(MALID_MAX_REQUESTS / 2) },
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
