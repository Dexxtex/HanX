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
  if (stripColonAfter && normalized.includes(stripColonAfter)) {
    normalized = normalized.replace(':', '');
  }
  return collapseSpaces ? normalized.replace(/\s{2,}/g, ' ').trim() : normalized.trim();
}

/** Query di ripiego usate quando la ricerca normale non restituisce risultati. */
export function buildTitleFallbackQueries(normalized: string): string[] {
  const queries: string[] = [];
  if (normalized.includes("'")) queries.push(normalized.replace(/'/g, ''));
  if (normalized.includes('(')) queries.push(normalized.split('(')[0].trim());
  const words = normalized.split(' ');
  if (words.length > 3) queries.push(words.slice(0, 3).join(' '));
  const plus = normalized.replace(/\s+/g, '+');
  if (plus !== normalized) queries.push(plus);
  return queries;
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
