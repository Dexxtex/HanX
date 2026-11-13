/**
 * L'episodio successivo nello stesso id, incrementando il numero finale.
 * `kitsu:42765:24` -> `kitsu:42765:25`, `mal:1535:1:1` -> `mal:1535:1:2`.
 * null se l'id non finisce con un numero.
 */
export function nextEpisodeId(id: string): string | null {
  // L'id senza episodio (es. "kitsu:42765") non ha un "successivo": incrementare
  // l'ultimo numero scaldava un altro anime. Serve la componente episodio.
  if (String(id || '').split(':').length < 3) return null;
  const next = String(id || '').replace(/(\d+)$/, (n) => String(Number(n) + 1));
  return next !== id ? next : null;
}
