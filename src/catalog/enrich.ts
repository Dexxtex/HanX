/**
 * Arricchimento delle schede del catalogo: legge la pagina, prende gli id e i
 * campi che la scheda dichiara, e chiude la scheda (`enrichedAt`) solo con un
 * esito definitivo.
 *
 * Sta qui e non nello script perché qui è testabile e passata dal type-check:
 * `tsconfig.json` include solo `src/`, quindi la logica scritta in `scripts/`
 * compila soltanto a runtime. L'I/O arriva iniettato (`readPage`, `fetcher`).
 */
import { confirmMalIds } from './anilist.js';
import {
  applyCardDetails,
  CATALOG_SITES,
  isEnrichmentFinal,
  parseCardDetails,
  pendingEnrichment,
  type CatalogEntry,
  type CatalogFile,
} from './sync.js';

/** Siti con il backfill: Unity porta già il `malId` dall'API. */
const ENRICH_SITES = ['saturn', 'world'] as const;

export interface EnrichOptions {
  /** HTML della scheda. Lancia sull'errore: `isBlocked` decide se fermarsi. */
  readPage: (entry: CatalogEntry) => Promise<string>;
  /** true solo per 403/429: il WAF si prolunga se si insiste. */
  isBlocked: (err: unknown) => boolean;
  /** Schede per sito da leggere in una run. */
  quota: number;
  /** Timestamp oltre il quale la fase si ferma (il job ha un tetto di tempo). */
  deadline: number;
  /** Testo breve di un errore, senza segreti. */
  describe: (err: unknown) => string;
  today?: string;
  now?: () => number;
  fetcher?: typeof fetch;
  delayMs?: number;
  log?: (line: string) => void;
}

export interface EnrichResult {
  /** Schede lette (la scheda è arrivata, anche se senza id). */
  read: number;
  /** Schede che erano da leggere prima della run, su tutti i siti. */
  pending: number;
}

/**
 * Zero lette su un backlog non vuoto non è "arricchimento fatto": è un blocco o
 * una deadline già scaduta, e la run deve uscire rossa per dirlo.
 */
export function enrichmentStalled(result: EnrichResult): boolean {
  return result.pending > 0 && result.read === 0;
}

export async function enrichMalIds(catalog: CatalogFile, options: EnrichOptions): Promise<EnrichResult> {
  const now = options.now ?? Date.now;
  const today = options.today ?? new Date(now()).toISOString().slice(0, 10);
  const log = options.log ?? ((line: string) => console.log(line));
  // Il backlog si conta su entrambi i siti **prima** del ciclo: se la deadline
  // scade dopo Saturn, il backlog di World non deve sparire dai conti.
  const pendingBySite = Object.fromEntries(
    ENRICH_SITES.map((site) => [site, pendingEnrichment(catalog.sites[site], today)])
  ) as Record<(typeof ENRICH_SITES)[number], CatalogEntry[]>;
  const pending = ENRICH_SITES.reduce((sum, site) => sum + pendingBySite[site].length, 0);
  let read = 0;
  for (const site of ENRICH_SITES) {
    const entries = catalog.sites[site];
    // Prima le schede mai lette (le nuove comprese), poi le più vecchie: quelle
    // lette da poco non si rileggono.
    const found: { entry: CatalogEntry; details: ReturnType<typeof parseCardDetails> }[] = [];
    let requests = 0;
    for (const entry of pendingBySite[site]) {
      if (requests >= options.quota || now() > options.deadline) break;
      requests += 1;
      try {
        found.push({ entry, details: parseCardDetails(await options.readPage(entry), site) });
      } catch (err) {
        // Un blocco ferma il sito; una scheda rotta si salta e la run continua.
        if (options.isBlocked(err)) {
          log(`[catalog] malId ${site}: BLOCCATO — ${options.describe(err)}`);
          break;
        }
        log(`[catalog] malId ${site}: scheda saltata — ${options.describe(err)}`);
      }
    }
    // Solo gli id che AniList conferma: una pagina con il link MAL sbagliato non
    // deve entrare nel ramo esatto del matcher.
    read += found.length;
    const { confirmed, answered } = await confirmMalIds(
      found.map((item) => item.details),
      options.fetcher,
      { delayMs: options.delayMs }
    );
    let accepted = 0;
    let rejected = 0;
    let unanswered = 0;
    let skipped = 0;
    let aliased = 0;
    for (const { entry, details } of found) {
      // Il resto della scheda si salva comunque: sono dati del sito, non id di
      // altri cataloghi. Solo il malId ha bisogno di conferma.
      const aliasesBefore = entry.titles?.length || 0;
      applyCardDetails(entry, details, confirmed);
      if (!details.malId || !details.anilistId) skipped += 1;
      else if (!answered.has(details.anilistId)) unanswered += 1;
      else if (confirmed.get(details.anilistId) === details.malId) accepted += 1;
      else rejected += 1;
      if ((entry.titles?.length || 0) > aliasesBefore) aliased += 1;
      // `enrichedAt` solo per un esito definitivo: la scheda senza link MAL o
      // senza link AniList non ha niente da confermare, quella muta si riprova.
      if (isEnrichmentFinal(details, answered)) entry.enrichedAt = today;
    }
    const withMalId = entries.filter((entry) => entry.malId).length;
    log(
      `[catalog] schede ${site}: ${found.length} lette, ${accepted} malId confermati, ${rejected} rifiutati, ` +
        `${unanswered} in attesa di AniList, ${skipped} senza id da confermare, ${aliased} con alias nuovi ` +
        `(${withMalId}/${entries.length} con malId)`
    );
    if (now() > options.deadline) break;
  }
  // Unity non è nella lista perché il suo `malId` arriva già dall'API: senza
  // questa riga nei log sembrerebbe un sito che non è stato letto.
  for (const site of CATALOG_SITES) {
    if ((ENRICH_SITES as readonly string[]).includes(site)) continue;
    const entries = catalog.sites[site];
    const withMalId = entries.filter((entry) => entry.malId).length;
    log(`[catalog] schede ${site}: nessun backfill (malId dall'API del sito), ${withMalId}/${entries.length} con malId`);
  }
  return { read, pending };
}
