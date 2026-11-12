/**
 * L'episodio successivo nello stesso id, incrementando il numero finale.
 * `kitsu:42765:24` -> `kitsu:42765:25`, `mal:1535:1:1` -> `mal:1535:1:2`.
 * null se l'id non finisce con un numero.
 */
export function nextEpisodeId(id: string): string | null {
  const next = String(id || '').replace(/(\d+)$/, (n) => String(Number(n) + 1));
  return next !== id ? next : null;
}
