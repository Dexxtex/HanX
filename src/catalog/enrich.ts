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
  type CardDetails,
  type CatalogEntry,
  type CatalogFile,
} from './sync.js';

/**
 * Siti con il backfill. Unity non ha bisogno di AniList (il `malId` arriva
 * dall'API), ma la sua pagina porta le coppie `[numero, id]` degli episodi:
 * senza quelle il provider deve scaricarla a ogni richiesta.
 */
const ENRICH_SITES = ['saturn', 'world', 'unity'] as const;
/** Solo Unity: la scheda si legge per gli id episodio, non per il malId. */
const EPISODE_SITES: ReadonlySet<string> = new Set(['unity']);

export interface EnrichOptions {
  /** HTML della scheda. Lancia sull'errore: `isBlocked` decide se fermarsi. */
  readPage: (entry: CatalogEntry) => Promise<string>;
  /**
   * Solo per i siti in `EPISODE_SITES`: gli id episodio da un endpoint dedicato.
   * Unity li dà in 3,8 KB contro i ~95 KB della scheda, e senza il tetto di 120.
   */
  readEpisodes?: (entry: CatalogEntry) => Promise<[number, number | string][] | null>;
  /** true solo per 403/429: il WAF si prolunga se si insiste. */
  isBlocked: (err: unknown) => boolean;
  /** Schede per sito da leggere in una run. */
  quota: number;
  /** Quota diversa per un sito specifico (Unity legge per gli id episodio). */
  quotaBySite?: Partial<Record<(typeof ENRICH_SITES)[number], number>>;
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

  /**
   * Un sito per volta, ma i tre siti in parallelo: sono host diversi e il pacing
   * del sync è per host, quindi in fila due siti restavano fermi mentre il terzo
   * lavorava. Ogni host vede la stessa tariffa, e la run dura il sito più lungo.
   */
  async function enrichSite(site: (typeof ENRICH_SITES)[number]): Promise<number> {
    const entries = catalog.sites[site];
    // Prima le schede mai lette (le nuove comprese), poi le più vecchie: quelle
    // lette da poco non si rileggono.
    const found: { entry: CatalogEntry; details: ReturnType<typeof parseCardDetails> }[] = [];
    const siteQuota = options.quotaBySite?.[site] ?? options.quota;
    let requests = 0;
    for (const entry of pendingBySite[site]) {
      if (requests >= siteQuota || now() > options.deadline) break;
      requests += 1;
      try {
        let details: CardDetails;
        if (options.readEpisodes && EPISODE_SITES.has(site)) {
          const ep = await options.readEpisodes(entry);
          details = { malId: null, anilistId: null, ...(ep?.length ? { ep } : {}) };
        } else {
          details = parseCardDetails(await options.readPage(entry), site);
        }
        found.push({ entry, details });
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
    // Unity non passa da AniList: il suo malId viene dall'API del sito e qui si
    // leggono solo gli id episodio. Una mappa vuota lascia `malId` invariato.
    const { confirmed, answered } = EPISODE_SITES.has(site)
      ? { confirmed: new Map<number, number>(), answered: new Set<number>() }
      : await confirmMalIds(
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
      // Per i siti da cui si leggono gli id episodio, definitivo significa anche
      // "ep letti": altrimenti un errore di lettura chiudeva la scheda per sempre.
      if (isEnrichmentFinal(details, answered) && (!EPISODE_SITES.has(site) || details.ep))
        entry.enrichedAt = today;
    }
    if (EPISODE_SITES.has(site)) {
      // Niente AniList qui: il conteggio utile è quante schede hanno gli id.
      const withEp = entries.filter((entry) => entry.ep?.length).length;
      log(
        `[catalog] schede ${site}: ${found.length} lette per gli id episodio, ` +
          `${aliased} con alias nuovi (${withEp}/${entries.length} con id episodio)`
      );
    } else {
      const withMalId = entries.filter((entry) => entry.malId).length;
      log(
        `[catalog] schede ${site}: ${found.length} lette, ${accepted} malId confermati, ${rejected} rifiutati, ` +
          `${unanswered} in attesa di AniList, ${skipped} senza id da confermare, ${aliased} con alias nuovi ` +
          `(${withMalId}/${entries.length} con malId)`
      );
    }
    return found.length;
  }

  const reads = await Promise.all(ENRICH_SITES.map((site) => enrichSite(site)));
  const read = reads.reduce((sum, count) => sum + count, 0);
  // Un sito senza backfill non si legge: senza questa riga nei log sembrerebbe
  // un sito dimenticato. Oggi nessun sito è fuori dalla lista, ma la riga resta
  // per il giorno in cui uno esce.
  for (const site of CATALOG_SITES) {
    if ((ENRICH_SITES as readonly string[]).includes(site)) continue;
    const entries = catalog.sites[site];
    const withMalId = entries.filter((entry) => entry.malId).length;
    log(`[catalog] schede ${site}: nessun backfill (malId dall'API del sito), ${withMalId}/${entries.length} con malId`);
  }
  return { read, pending };
}
