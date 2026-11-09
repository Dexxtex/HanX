/**
 * Decodifica delle entità HTML: una sola implementazione per i tre siti e per
 * il catalogo.
 *
 * Le entità numeriche si convertono **tutte**, non un elenco: i siti scrivono
 * `&#039;` con lo zero davanti, e un elenco fisso di `&#39;` lasciava il titolo
 * grezzo (`The World&#039;s Strongest Witch`). Il caso è già costato un bug su
 * AnimeSaturn ed era ancora aperto su AnimeUnity e sul catalogo.
 */
export function decodeHtmlEntities(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/&quot;/gi, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#0*(\d+);/g, (_, dec: string) => fromCodePoint(Number(dec)))
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

/** `String.fromCodePoint` lancia fuori range: un'entità rotta non deve fermare il parse. */
function fromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** Testo da HTML: via i tag, poi le entità, poi gli spazi collassati. */
export function htmlToText(value: string | null | undefined): string {
  return decodeHtmlEntities(String(value ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}
