export type TitleReplacements = ReadonlyArray<readonly [string, string]>;

export interface TitleNormalizationOptions {
  exactMap: Readonly<Record<string, string>>;
  replacements: TitleReplacements;
  /** 'regex' = case-insensitive e globale (AnimeWorld/AnimeUnity); 'literal' = come il codice storico AnimeSaturn. */
  replacementMode?: 'regex' | 'literal';
  /** Rimuove il primo ':' quando il titolo contiene questo testo. */
  stripColonAfter?: string;
  /** Sostituisce " - " con uno spazio (comportamento AnimeSaturn). */
  stripSpacedHyphen?: boolean;
  /** Collassa gli spazi multipli. Default: true. */
  collapseSpaces?: boolean;
}

/** Cerca la chiave exactMap sul titolo originale e poi su quello universale. */
export function resolveExactMapKey(
  originalTitle: string,
  universalTitle: string,
  exactMap: Readonly<Record<string, string>>
): string | null {
  if (Object.prototype.hasOwnProperty.call(exactMap, originalTitle)) return originalTitle;
  if (Object.prototype.hasOwnProperty.call(exactMap, universalTitle)) return universalTitle;
  return null;
}

/**
 * Normalizza un titolo per la ricerca. Gli exactMap hanno precedenza sui replacement.
 * I replacement sono applicati in ordine, come nel codice storico dei provider.
 */
export function normalizeTitleForSearch(
  title: string,
  options: TitleNormalizationOptions,
  exactKey?: string | null
): string {
  const { exactMap, replacements, replacementMode = 'regex', stripColonAfter, stripSpacedHyphen, collapseSpaces = true } = options;
  const key = exactKey && Object.prototype.hasOwnProperty.call(exactMap, exactKey)
    ? exactKey
    : (Object.prototype.hasOwnProperty.call(exactMap, title) ? title : null);
  if (key) return exactMap[key];

  let normalized = title;
  for (const [from, to] of replacements) {
    if (!normalized.includes(from)) continue;
    normalized = replacementMode === 'literal'
      ? normalized.replace(from, to)
      : normalized.replace(new RegExp(from, 'gi'), to);
  }
  if (stripSpacedHyphen) normalized = normalized.replace(/\s+-\s+/g, ' ');
  // I siti scrivono la stagione in cifre: "Space Dandy 2nd Season" -> "Space
  // Dandy 2". Solo in coda o davanti a "season/part/cour", così "1st Love"
  // resta intatto.
  normalized = normalized
    .replace(/\b(\d+)(?:st|nd|rd|th)\s+(?:season|part|cour)\b/gi, '$1')
    .replace(/\b(\d+)(?:st|nd|rd|th)\s*$/i, '$1');
  // Simboli decorativi ("Fuuun Ishin Dai☆Shougun"): con la stella nella query
  // Saturn e World rispondono 0, mentre la scheda è "Dai Shogun". Sostituiti da
  // spazio, così il titolo resta leggibile e i token combaciano.
  normalized = normalized.replace(/[☆★♪♫♬♥♡♦◆◇●○■□▲△▼▽]/g, ' ');
  if (stripColonAfter && normalized.includes(stripColonAfter)) {
    normalized = normalized.replace(':', '');
  }
  return collapseSpaces ? normalized.replace(/\s{2,}/g, ' ').trim() : normalized.trim();
}

/** Numeri romani di stagione: i siti italiani scrivono "2" dove Kitsu/MAL scrivono "II". */
const ROMAN_NUMERALS: Record<string, string> = {
  ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9',
  x: '10', xi: '11', xii: '12',
};

/** Converte solo un numero romano in coda: "Edgerunners II" -> "Edgerunners 2". */
function romanSuffixToDigits(title: string): string {
  return title.replace(/\s+(ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)$/i, (match, roman) => {
    const digits = ROMAN_NUMERALS[String(roman).toLowerCase()];
    return digits ? ` ${digits}` : match;
  });
}

/** Query di ripiego usate quando la ricerca normale non restituisce risultati. */
export function buildTitleFallbackQueries(normalized: string): string[] {
  const queries: string[] = [];
  // "CYBERPUNK: EDGERUNNERS II" cercato alla lettera dà 0 risultati: sui siti è "2".
  const romanDigits = romanSuffixToDigits(normalized);
  // Stesso motivo per gli ordinali inglesi: "Space Dandy 2nd" -> "Space Dandy 2".
  const ordinalDigits = normalized.replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, '$1');
  // Nei titoli "franchise: sottotitolo" la parte distintiva è la coda: cercare
  // "Mobile Suit Gundam" riporta il franchise (10 schede, il film non c'è),
  // "Flights of Fancy" riporta la scheda esatta. Va per prima: il sito
  // restituisce al massimo 10 risultati, e la coda è quella che ci entra.
  const colonTail = romanSuffixToDigits(normalized.split(':').slice(1).join(':').trim())
    .replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, '$1');
  // "Ah! My Goddess: The Movie" -> "The Movie" non è una query: la coda deve
  // avere almeno un token che non sia articolo o suffisso di formato.
  const tailTokens = colonTail.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const tailDistinctive = tailTokens.some(
    (token) => !TITLE_STOP_WORDS.has(token) && !TITLE_SEASON_SUFFIXES.has(token) && !TITLE_LANGUAGE_WORDS.has(token)
  );
  if (colonTail && tailDistinctive && colonTail !== normalized && tailTokens.length >= 2) queries.push(colonTail);
  if (romanDigits !== normalized && !queries.includes(romanDigits)) queries.push(romanDigits);
  if (ordinalDigits !== normalized && !queries.includes(ordinalDigits)) queries.push(ordinalDigits);
  // I provider usano spesso il titolo della serie senza il sottotitolo della stagione.
  const colonBase = normalized.split(':')[0].trim();
  if (colonBase !== normalized && colonBase.split(/\s+/).length >= 2 && !queries.includes(colonBase)) queries.push(colonBase);
  const dashBase = normalized.split(/\s+-\s+/)[0].trim();
  if (dashBase !== normalized && dashBase.split(/\s+/).length >= 2 && !queries.includes(dashBase)) queries.push(dashBase);
  // "Hungry Heart: Wild Striker - La squadra del cuore" è un titolo ibrido di
  // TMDB: sui siti italiani esiste solo la seconda metà.
  const dashTail = normalized.split(/\s+-\s+/).slice(1).pop()?.trim();
  if (dashTail && dashTail !== normalized && dashTail.split(/\s+/).length >= 2 && !queries.includes(dashTail)) queries.push(dashTail);
  if (normalized.includes("'")) queries.push(normalized.replace(/'/g, ''));
  if (normalized.includes('(')) queries.push(normalized.split('(')[0].trim());
  const words = normalized.split(' ');
  if (words.length > 3) queries.push(words.slice(0, 3).join(' '));
  const plus = normalized.replace(/\s+/g, '+');
  if (plus !== normalized) queries.push(plus);
  return queries;
}

const TITLE_STOP_WORDS = new Set([
  'a', 'an', 'and', 'dei', 'del', 'della', 'delle', 'di', 'e', 'for', 'ga', 'in',
  'no', 'of', 'on', 'the', 'to', 'wa', 'with', 'wo',
]);
const TITLE_LANGUAGE_WORDS = new Set(['cr', 'dub', 'eng', 'ita', 'jp', 'jap', 'sub', 'subita']);
const TITLE_SEASON_SUFFIXES = new Set([
  'arc', 'chapter', 'cour', 'hen', 'movie', 'ona', 'ova', 'part', 'saga', 'season', 'special',
]);

function titleTokens(title: string): string[] {
  const tokens = String(title || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token && !TITLE_STOP_WORDS.has(token) && !TITLE_LANGUAGE_WORDS.has(token))
    // "II" e "2" sono la stessa stagione: senza questo, il titolo trovato viene scartato dal filtro.
    .map((token) => ROMAN_NUMERALS[token] || token.replace(/^(\d+)(?:st|nd|rd|th)$/, '$1'));
  // "Tenjiku-hen" e "Tenjiku Arc" sono lo stesso sottotitolo.
  while (tokens.length > 1 && TITLE_SEASON_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens;
}

/**
 * 1 = stesso titolo. 0.9 = stesso sottotitolo, con una parte extra non
 * numerata. 0.5 = stessa serie e almeno un token del sottotitolo in comune
 * ("The Three Deities" / "War of the Three Titans Arc"). 0 = non correlato.
 */
export function titleMatchScore(requested: string, candidate: string): number {
  const query = titleTokens(requested);
  const found = titleTokens(candidate);
  if (!query.length || !found.length) return 0;

  const queryKey = query.join(' ');
  const foundKey = found.join(' ');
  if (queryKey === foundKey) return 1;

  // A bare series title must not match a season that only adds a subtitle.
  const bothHaveSubtitle = /:|\s+-\s+/.test(requested) && /:|\s+-\s+/.test(candidate);
  if (bothHaveSubtitle && (foundKey.includes(queryKey) || queryKey.includes(foundKey))) {
    const longer = queryKey.length >= foundKey.length ? query : found;
    const shorterLength = Math.min(query.length, found.length);
    const hasNumber = longer.slice(shorterLength).some((token) => /^\d+$/.test(token));
    if (!hasNumber) return 0.9;
  }

  let sharedPrefix = 0;
  while (
    sharedPrefix < query.length &&
    sharedPrefix < found.length &&
    query[sharedPrefix] === found[sharedPrefix]
  ) sharedPrefix += 1;
  if (!sharedPrefix) return 0;

  const queryRest = [...new Set(query.slice(sharedPrefix))];
  const foundRest = new Set(found.slice(sharedPrefix));
  if (!queryRest.length || !foundRest.size) return 0;

  const shared = queryRest.filter((token) => foundRest.has(token)).length;
  return shared ? shared / Math.min(queryRest.length, foundRest.size) : 0;
}

/**
 * Miglior punteggio tra i titoli noti dell'opera (inglese + romaji MAL): i siti
 * italiani a volte listano il romaji, che con il solo titolo inglese prende 0.
 */
export function titleMatchScoreAny(titles: string[], candidate: string): number {
  let best = 0;
  for (const title of titles) {
    const score = titleMatchScore(title, candidate);
    if (score > best) best = score;
  }
  return best;
}

/** Chiave usata per confrontare titoli mostrati nei risultati. */
export function normalizeSearchTitleKey(title: string): string {
  return String(title || '')
    .replace(/\((?:ITA|CR|SUB\s*ITA)\)/gi, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Slug senza id finale e senza suffisso di lingua: identifica l'opera, non la versione. */
export function animeSlugBase(slugOrName: string): string {
  return String(slugOrName || '')
    .split('.')[0]
    .toLowerCase()
    .replace(/(?:^|[-_])(?:sub[-_]?ita|cr[-_]?ita|ita[-_]?cr|ita)$/, '');
}
