import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { compactKey } from './text.js';

export type CatalogSite = 'saturn' | 'world' | 'unity';

/** Lingua della scheda: le varianti ita/sub sono schede diverse dello stesso anime. */
export type CatalogLanguage = 'ITA' | 'CR ITA' | 'SUB ITA';

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
  /** Solo AnimeUnity: TV/Movie/OVA/ONA/Special/TV Short. */
  type?: string;
  /** Solo AnimeUnity: id MAL della scheda, per il join esatto quando il titolo non basta. */
  malId?: number;
  /** Solo AnimeUnity: stagione dichiarata dal sito. */
  season?: string;
  /** Lingua dichiarata dal sito (oggi solo Unity, campo `dub`). Assente = si deduce. */
  language?: CatalogLanguage;
  /** Data di inizio dichiarata dal sito (`YYYY-MM-DD`), per disambiguare remake omonimi. */
  startDate?: string;
  /** Episodi dichiarati: dice se l'episodio richiesto può stare in questa scheda. */
  episodes?: number;
  /** Id AniList: valida il `malId` delle schede e regge un futuro join `anilist:`. */
  anilistId?: number;
  /**
   * Giorno in cui la scheda è stata letta l'ultima volta (`YYYY-MM-DD`). Senza
   * questo, una scheda senza id AniList verrebbe riletta a ogni run per sempre.
   */
  enrichedAt?: string;
}

/** Quante schede si rileggono al giorno oltre al backlog: rinfresco, non ricorsa. */
const ENRICH_REFRESH_DAYS = 30;

/**
 * Schede da leggere, in ordine: prima quelle mai lette (le nuove incluse), poi
 * le più vecchie. Una scheda letta da meno di `refreshDays` non si rilegge, così
 * le schede senza id AniList non consumano la quota all'infinito.
 */
export function pendingEnrichment(
  entries: CatalogEntry[],
  today: string,
  refreshDays = ENRICH_REFRESH_DAYS
): CatalogEntry[] {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - refreshDays);
  const limit = cutoff.toISOString().slice(0, 10);
  return entries
    .filter((entry) => !entry.enrichedAt || entry.enrichedAt < limit)
    .sort((a, b) => (a.enrichedAt || '').localeCompare(b.enrichedAt || ''));
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
  /** Solo AnimeUnity: id MAL, per il match esatto senza passare dai titoli. */
  malId?: number;
  /** Lingua dichiarata dal sito (oggi solo Unity, campo `dub`). Assente = si deduce. */
  language?: CatalogLanguage;
  /** Episodi dichiarati: il matcher scarta la scheda se la richiesta li supera. */
  episodes?: number;
}

export interface TitleIndexFile {
  generatedAt: string | null;
  sites: Record<CatalogSite, TitleIndexEntry[]>;
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

/**
 * I due id esterni della scheda: Saturn li mette nel blocco `ag-links`, World
 * nel riquadro `watchlist-edit-mal`. Il primo link di ciascuno è quello della
 * serie (le pagine non hanno altri link MAL/AniList). L'id AniList serve a
 * validare quello MAL: da solo non si salva niente.
 */
export function parseCardIds(html: string): { malId: number | null; anilistId: number | null } {
  const text = String(html || '');
  const id = (match: RegExpMatchArray | null): number | null => {
    const value = match ? Number(match[1]) : Number.NaN;
    return Number.isFinite(value) && value > 0 ? value : null;
  };
  return {
    malId: id(text.match(/myanimelist\.net\/anime\/(\d+)/)),
    anilistId: id(text.match(/anilist\.co\/anime\/(\d+)/)),
  };
}

/**
 * Il crawl riparte da sitemap e listing, che gli id e i dati delle schede non li
 * hanno: senza questo, ogni notte si perderebbe tutto l'arricchimento fatto
 * finora. Si riporta solo ciò che la entry fresca non ha già: titolo, url, slug
 * e tipo restano quelli del crawl di oggi.
 */
export function carryOverProgress(previous: CatalogEntry[], entries: CatalogEntry[]): number {
  const bySlug = new Map<string, CatalogEntry>();
  for (const entry of previous) bySlug.set(entry.slug, entry);
  let carried = 0;
  for (const entry of entries) {
    const old = bySlug.get(entry.slug);
    if (!old) continue;
    let touched = false;
    const field = <K extends keyof CatalogEntry>(key: K, value: CatalogEntry[K] | undefined): void => {
      if (value === undefined || entry[key] !== undefined) return;
      entry[key] = value;
      touched = true;
    };
    field('malId', old.malId);
    field('anilistId', old.anilistId);
    field('enrichedAt', old.enrichedAt);
    field('language', old.language);
    field('episodes', old.episodes);
    field('startDate', old.startDate);
    field('year', old.year);
    // I titoli si sommano: gli alias presi dalla scheda e quelli di ieri sono
    // tutti veri, e un titolo diverso già presente non si sovrascrive.
    const titles = new Set([...(entry.titles || []), ...(old.titles || [])]);
    if (titles.size > (entry.titles?.length || 0)) {
      entry.titles = [...titles];
      touched = true;
    }
    if (touched) carried += 1;
  }
  return carried;
}

/** Dalla pagina di una scheda si prendono solo i campi che risolvono una richiesta. */
export interface CardDetails {
  malId: number | null;
  anilistId: number | null;
  titles?: string[];
  episodes?: number;
  year?: number;
  startDate?: string;
  language?: CatalogLanguage;
}

/** "Lingua Giapponese" nella scheda: Italiano = doppiato, il resto = sottotitolato. */
function saturnLanguage(html: string): CatalogLanguage | undefined {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  const match = text.match(/Lingua\s+(Italiano|Giapponese|Inglese|Francese|Spagnolo|Tedesco)/i);
  if (!match) return undefined;
  return /italiano/i.test(match[1]) ? 'ITA' : 'SUB ITA';
}

/**
 * World non mette niente di questo nel JSON-LD né nel listing: lo dichiara nella
 * pagina, in una lista `<dt>/<dd>`. Si prendono solo i campi che risolvono una
 * richiesta: episodi, anno/data e lingua audio (Italiano = doppiato, altro =
 * sottotitolato). Studio, durata, stato e visualizzazioni restano dove stanno.
 */
function worldInfo(html: string): { episodes?: number; year?: number; startDate?: string; language?: CatalogLanguage } {
  const fields = new Map<string, string>();
  for (const match of html.matchAll(/<dt>\s*([^<]+?)\s*<\/dt>\s*<dd>([\s\S]{0,200}?)<\/dd>/g)) {
    // L'etichetta arriva con i due punti: "Audio:", "Episodi:", "Data di Uscita:".
    const label = match[1].toLowerCase().replace(/:\s*$/, '');
    fields.set(label, match[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
  }
  const year = Number(fields.get('anno'));
  const episodes = Number(fields.get('episodi'));
  const date = fields.get('data di uscita')?.toLowerCase().match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
  const month = date ? SATURN_MONTHS.indexOf(date[2]) : -1;
  const audio = fields.get('audio')?.toLowerCase() || '';
  return {
    ...(Number.isFinite(episodes) && episodes > 0 ? { episodes } : {}),
    ...(Number.isFinite(year) && year > 1900 ? { year } : {}),
    ...(month >= 0
      ? { startDate: `${date![3]}-${String(month + 1).padStart(2, '0')}-${date![1].padStart(2, '0')}` }
      : {}),
    ...(audio ? { language: (/italian/.test(audio) ? 'ITA' : 'SUB ITA') as CatalogLanguage } : {}),
  };
}

/**
 * Conteggio episodi di World: `Episodi` del blocco informazioni; se manca, `max`
 * del campo "Episodi visti" (Another: max 12 con l'episodio 0 in lista) e infine
 * il massimo `data-episode-num` della lista episodi.
 */
function worldEpisodes(html: string): number | undefined {
  const max = Number(html.match(/id="watchlist-edit-episodes"[^>]*\bmax="(\d+)"/)?.[1]);
  if (Number.isFinite(max) && max > 0) return max;
  const numbers = [...html.matchAll(/data-episode-num="(\d+)"/g)].map((match) => Number(match[1]));
  const highest = numbers.length ? Math.max(...numbers) : Number.NaN;
  return Number.isFinite(highest) && highest > 0 ? highest : undefined;
}

/** `alternateName` è una stringa o una lista, secondo schema.org. */
function asList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value];
  return raw.map((item) => cleanText(item, 200)).filter((item): item is string => Boolean(item));
}

/**
 * Saturn dichiara un `TVSeries` (alternateName, datePublished, numberOfEpisodes),
 * World un `TVEpisode` con `partOfSeries`. Entrambi hanno i link MAL/AniList più
 * in basso nella pagina. Trama, generi e voto si lasciano dove stanno: non
 * risolvono nessuna richiesta.
 */
export function parseCardDetails(html: string, site: CatalogSite): CardDetails {
  const text = String(html || '');
  const json = text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  let data: Record<string, any> = {};
  try {
    data = json ? JSON.parse(json) : {};
  } catch {
    // JSON-LD rotto: restano gli id, che stanno fuori.
  }
  const series: Record<string, any> = site === 'world' ? data.partOfSeries || {} : data;
  const info = site === 'world' ? worldInfo(text) : {};
  // Saturn scrive "Lingua <Giapponese|Italiano>": la lingua audio della scheda,
  // più affidabile del suffisso "(ITA)" del titolo.
  const saturnAudio = site === 'saturn' ? saturnLanguage(text) : undefined;
  const year = String(data.datePublished || '').match(/^(\d{4})/);
  const episodes = positive(data.numberOfEpisodes) ?? positive(info.episodes) ?? (site === 'world' ? worldEpisodes(text) : undefined);
  return {
    ...parseCardIds(text),
    ...(asList(series.alternateName).length ? { titles: asList(series.alternateName) } : {}),
    ...(episodes ? { episodes } : {}),
    ...(year ? { year: Number(year[1]) } : {}),
    ...(info.year && !year ? { year: info.year } : {}),
    ...(info.startDate ? { startDate: info.startDate } : {}),
    ...(info.language ?? saturnAudio ? { language: (info.language ?? saturnAudio)! } : {}),
  };
}

/**
 * Fonde i dati della scheda nella entry del catalogo. Il titolo del listing non
 * si tocca (è quello che l'utente vede); `malId` entra solo se AniList conferma
 * che l'id AniList della stessa pagina punta a quel MAL.
 */
export function applyCardDetails(entry: CatalogEntry, details: CardDetails, confirmed: Map<number, number>): void {
  const titles = new Set(entry.titles || []);
  for (const title of details.titles || []) {
    if (compactKey(title) !== compactKey(entry.titleSite)) titles.add(title);
  }
  if (titles.size) entry.titles = [...titles];
  if (details.episodes && !entry.episodes) entry.episodes = details.episodes;
  if (details.startDate && !entry.startDate) entry.startDate = details.startDate;
  if (details.language && !entry.language) entry.language = details.language;
  if (details.year && !entry.year) entry.year = details.year;
  if (details.anilistId) entry.anilistId = details.anilistId;
  if (details.malId && details.anilistId && confirmed.get(details.anilistId) === details.malId) {
    entry.malId = details.malId;
  }
}

/**
 * Esito definitivo: nessun id da verificare, oppure AniList ha risposto.
 * Senza link AniList non c'è niente da verificare: aspettare una risposta che
 * non arriverà mai rimetterebbe la scheda in testa alla coda a ogni run.
 */
export function isEnrichmentFinal(details: CardDetails, answered: Set<number>): boolean {
  return !details.malId || !details.anilistId || answered.has(details.anilistId);
}

/** Il listing deve coprire almeno questa quota delle schede della sitemap. */
export const SATURN_MIN_COVERAGE = 0.98;

/**
 * Il listing che arricchisce meno del 98% delle schede della sitemap ha un buco
 * (markup cambiato, tipo nuovo): meglio una run rossa che un catalogo peggiore
 * pubblicato in silenzio. `null` quando la copertura è sufficiente.
 */
export function saturnListingGap(covered: number, spine: number): string | null {
  const min = Math.floor(spine * SATURN_MIN_COVERAGE);
  return covered < min ? `listing con buchi: ${covered}/${spine} schede arricchite (minimo ${min})` : null;
}

/** Numero utile solo se positivo e finito: il sito manda 0, "", null per "assente". */
function positive(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/** Testo di una scheda: senza markup ripetuto, senza spazi doppi, o assente. */
function cleanText(value: unknown, max = 1200): string | undefined {
  const text = String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, max) : undefined;
}

/** Le partizioni di /filter: camminarne una per tipo dà il tipo insieme al resto. */
export const SATURN_TYPES = ['TV', 'Movie', 'OVA', 'Special', 'ONA'] as const;

const SATURN_MONTHS = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
];

/** "08 Gennaio 2026 · 12 ep" → data ISO e episodi; ciascuno indipendente dall'altro. */
export function parseSaturnCardMeta(text: string): { startDate?: string; episodes?: number } {
  const lower = String(text || '').toLowerCase();
  const date = lower.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
  const month = date ? SATURN_MONTHS.indexOf(date[2]) : -1;
  const eps = lower.match(/(\d+)\s*ep(?![a-z])/);
  return {
    ...(month >= 0 ? { startDate: `${date![3]}-${String(month + 1).padStart(2, '0')}-${date![1].padStart(2, '0')}` } : {}),
    ...(eps ? { episodes: Number(eps[1]) } : {}),
  };
}

/**
 * Una pagina di /filter: 30 card `a.ac` con titolo mostrato vero e sottotitolo
 * con data di inizio ed episodi. `type` arriva dalla partizione camminata.
 */
export function parseSaturnFilterPage(
  html: string,
  type?: string,
  base = 'https://www.animesaturn.net'
): CatalogEntry[] {
  const $ = cheerio.load(String(html || ''));
  const out: CatalogEntry[] = [];
  const seen = new Set<string>();
  $('a.ac').each((_, el) => {
    const $card = $(el);
    const href = String($card.attr('href') || '').trim();
    const slug = href.match(/^\/anime\/([^/?#]+)\/?$/)?.[1];
    const title = $card.find('.ac__title').first().text().replace(/\s+/g, ' ').trim();
    if (!slug || !title || seen.has(slug)) return;
    seen.add(slug);
    out.push({
      site: 'saturn',
      slug,
      url: `${base}${href}`,
      titleSite: title,
      ...parseSaturnCardMeta($card.find('.ac__sub').first().text()),
      ...(type ? { type } : {}),
    });
  });
  return out;
}

/**
 * AnimeWorld dichiara quante pagine ha /filter (`paginationMaxPage`). Oltre
 * l'ultima il sito ripete la prima pagina invece di rispondere vuota: senza
 * questo numero l'unico segnale di fine è la pagina ripetuta.
 */
export function parseWorldMaxPage(html: string): number | null {
  const match = String(html || '').match(/paginationMaxPage\s*=\s*parseInt\(\s*["'](\d+)["']/);
  const value = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
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
    const $name = $item.find('a.name').first();
    const title = (
      $name.text().trim() || String($item.find('img[alt]').first().attr('alt') || '').trim()
    ).replace(/\s+/g, ' ');
    if (!title) return;
    // data-jtitle è il titolo canonico del sito, spesso inglese o romaji: alias
    // gratis (44% delle card) senza chiedere le schede una per una.
    const jtitle = String($name.attr('data-jtitle') || '').replace(/\s+/g, ' ').trim();
    out.push({
      site: 'world',
      slug,
      url: `https://www.animeworld.ac/play/${path}`,
      titleSite: title,
      ...(jtitle && compactKey(jtitle) !== compactKey(title) ? { titles: [jtitle] } : {}),
    });
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
  mal_id?: number | null;
  anilist_id?: number | null;
  dub?: number | string | boolean | null;
  season?: string | null;
  episodes_count?: number | string | null;
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
      ...(record.type ? { type: String(record.type) } : {}),
      ...(Number(record.mal_id) > 0 ? { malId: Number(record.mal_id) } : {}),
      ...(positive(record.anilist_id) ? { anilistId: positive(record.anilist_id)! } : {}),
      ...(record.season ? { season: String(record.season) } : {}),
      // `dub` è l'unica lingua dichiarata dal sito; sulle altre si deduce dal titolo.
      ...(Number(record.dub) === 1 ? { language: 'ITA' as const } : {}),
      ...(positive(record.episodes_count) ? { episodes: positive(record.episodes_count)! } : {}),
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
  carryOverProgress(previous, next);
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
      ...(entry.malId ? { malId: entry.malId } : {}),
      ...(entry.language ? { language: entry.language } : {}),
      ...(entry.episodes ? { episodes: entry.episodes } : {}),
    }));
  }
  return { generatedAt: catalog.generatedAt, sites };
}

/** Scrive su .tmp e rinomina: un crash non lascia un file a metà. */
export function writeJsonAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data)}
`);
  fs.renameSync(tmp, file);
}

/** Scrive prima i due temporanei, poi rinomina: un crash non lascia la coppia a metà. */
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
