export type TitleReplacements = ReadonlyArray<readonly [string, string]>;

// Kitsu a volte pubblica i titoli con lettere cirilliche/greche identiche a
// quelle latine ("Jyuоu"): la query arriva ai siti con un carattere fantasma e
// non trova nulla. Si riportano solo i gemelli visivamente uguali, non le
// parole scritte davvero in cirillico.
const HOMOGLYPHS: Record<string, string> = {
  'а': 'a', 'А': 'A', 'е': 'e', 'Е': 'E', 'о': 'o', 'О': 'O', 'р': 'p', 'Р': 'P',
  'с': 'c', 'С': 'C', 'у': 'y', 'У': 'Y', 'х': 'x', 'Х': 'X', 'і': 'i', 'І': 'I',
  'ј': 'j', 'Ј': 'J', 'ѕ': 's', 'Ѕ': 'S', 'ԁ': 'd', 'Ԁ': 'D', 'һ': 'h', 'Һ': 'H',
  'ӏ': 'l', 'Ӏ': 'L', 'ο': 'o', 'Ο': 'O', 'α': 'a', 'Α': 'A', 'ε': 'e', 'Ε': 'E',
  'ι': 'i', 'Ι': 'I', 'κ': 'k', 'Κ': 'K', 'ρ': 'p', 'Ρ': 'P', 'τ': 't', 'Τ': 'T',
  'υ': 'u', 'Υ': 'Y', 'χ': 'x', 'Χ': 'X',
};

export function normalizeHomoglyphs(input: string): string {
  return String(input || '').replace(/[аАеЕоОрРсСуУхХіІјЈѕЅԁԀһҺӏӀοΟαΑεΕιΙκΚρΡτΤυΥχΧ]/g, (ch) => HOMOGLYPHS[ch] || ch);
}

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

  let normalized = normalizeHomoglyphs(title);
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
  // Varianti Unicode (U+2161…): Kitsu usa "Ⅱ" in "Demon King Academy Ⅱ".
  'ⅱ': '2', 'ⅲ': '3', 'ⅳ': '4', 'ⅴ': '5', 'ⅵ': '6', 'ⅶ': '7', 'ⅷ': '8', 'ⅸ': '9', 'ⅹ': '10',
};

/** Converte solo un numero romano in coda: "Edgerunners II" -> "Edgerunners 2". */
function romanSuffixToDigits(title: string): string {
  return title.replace(/\s+(xii|xi|viii|vii|iii|ii|ix|iv|vi|x|v|ⅷ|ⅶ|ⅲ|ⅱ|ⅸ|ⅳ|ⅵ|ⅹ|ⅴ)$/i, (match, roman) => {
    const digits = ROMAN_NUMERALS[String(roman).toLowerCase()];
    return digits ? ` ${digits}` : match;
  });
}

/**
 * Stessa query a meno di maiuscole e spazi. A differenza di sameTitle la
 * punteggiatura conta: "Kaiju No.8 2" e "Kaiju No. 8 2" sembrano lo stesso
 * titolo ma la ricerca del sito trova solo la seconda.
 */
export function sameQuery(a: string | null | undefined, b: string | null | undefined): boolean {
  const key = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const left = key(a);
  return Boolean(left) && left === key(b);
}

/** Query di ripiego usate quando la ricerca normale non restituisce risultati. */
export function buildTitleFallbackQueries(normalized: string, season?: number | null): string[] {
  const queries: string[] = [];
  // Kitsu scrive l'apostrofo tipografico ("Inukai-san’s"), il sito quello
  // dritto: la ricerca di AnimeSaturn li distingue e trova solo l'OVA.
  const straightApostrophe = normalized.replace(/[’‘`´]/g, "'");
  if (straightApostrophe !== normalized) queries.push(straightApostrophe);
  // I siti tengono una scheda per stagione e non indicizzano il sottotitolo
  // dell'arco: "Tower of God 2: Workshop Battle" sta nella pagina "Tower of
  // God 2". Va per prima, perché i ripieghi provati sono solo due.
  if (season && season > 1) {
    const seasonBase = romanSuffixToDigits(normalized.split(':')[0].split(/\s+-\s+/)[0].trim());
    if (seasonBase !== normalized && seasonBase.length >= 4) queries.push(seasonBase);
  }
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
// Suffissi che non identificano un'altra opera: "Show: Sub" e "Show: Sub
// Special" restano la stessa scheda. Un sottotitolo nuovo ("...: Final
// Member Selection Match") invece è un'altra stagione o un altro anime.
const FORMAT_SUFFIX_TOKENS = new Set([
  'movie', 'film', 'ova', 'ona', 'special', 'specials', 'recap', 'prologue',
  'edition', 'version', 'uncut', 'uncensored', 'short',
]);

function titleTokens(title: string): string[] {
  const tokens = normalizeHomoglyphs(String(title || ''))
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
 * 1 = stesso titolo. 0.9 = stesso sottotitolo, con in più solo un suffisso di
 * formato (movie, special, OVA...). 0.5 = stessa serie e almeno un token del
 * sottotitolo in comune ("The Three Deities" / "War of the Three Titans Arc").
 * 0 = non correlato.
 */
export function titleMatchScore(requested: string, candidate: string): number {
  const query = titleTokens(requested);
  const found = titleTokens(candidate);
  if (!query.length || !found.length) return 0;

  const queryKey = query.join(' ');
  const foundKey = found.join(' ');
  if (queryKey === foundKey) return 1;
  // "Kurumi-chan" e "Kurumichan" sono lo stesso titolo: le normalizzazioni dei
  // provider tolgono il trattino dalla query ma non dal titolo del sito.
  if (query.join('') === found.join('')) return 1;

  // A bare series title must not match a season that only adds a subtitle.
  const bothHaveSubtitle = /:|\s+-\s+/.test(requested) && /:|\s+-\s+/.test(candidate);
  if (bothHaveSubtitle && (foundKey.includes(queryKey) || queryKey.includes(foundKey))) {
    const longer = queryKey.length >= foundKey.length ? query : found;
    const shorterLength = Math.min(query.length, found.length);
    const extra = longer.slice(shorterLength);
    const hasNumber = extra.some((token) => /^\d+$/.test(token));
    // Solo un suffisso di formato: un sottotitolo extra è un'altra opera, e
    // un id sbagliato è peggio di un buco (DECISIONS #1).
    if (!hasNumber && extra.every((token) => FORMAT_SUFFIX_TOKENS.has(token))) return 0.9;
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
  return normalizeHomoglyphs(String(title || ''))
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
