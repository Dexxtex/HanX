/**
 * Validazione degli id MAL trovati sulle schede dei siti.
 *
 * La pagina della scheda contiene sia il link MyAnimeList sia quello AniList.
 * AniList sa a quale MAL corrisponde un suo id (`idMal`), quindi il confronto è
 * id↔id: non dipende dal titolo, che su un catalogo italiano è in italiano
 * mentre MAL è in romaji o inglese.
 *
 * Un id non confermato non si salva: meglio una scheda senza `malId` che un
 * database che ripete un link sbagliato.
 */

const ENDPOINT = 'https://graphql.anilist.co';
/** Quanti id per richiesta: il tetto di AniList è 90 richieste/minuto. */
const BATCH = 25;
const BATCH_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface CardIds {
  malId: number | null;
  anilistId: number | null;
}

export interface MalIdCheck {
  /** anilistId → malId che AniList conferma uguale a quello della pagina. */
  confirmed: Map<number, number>;
  /** anilistId per cui AniList ha risposto (media presente, con `idMal` anche null). */
  answered: Set<number>;
}

/**
 * Coppie (anilistId → malId) che AniList conferma, e gli id per cui ha risposto
 * davvero. Un 429, un 5xx o un errore di rete non confermano e non rispondono:
 * quelle schede restano senza `malId` e si riprovano alla run successiva, mentre
 * una risposta con `idMal` null o diverso è un esito definitivo.
 */
export async function confirmMalIds(
  pairs: CardIds[],
  fetcher: typeof fetch = fetch
): Promise<MalIdCheck> {
  const confirmed = new Map<number, number>();
  const answered = new Set<number>();
  const usable = pairs.filter(
    (pair): pair is { malId: number; anilistId: number } =>
      Number(pair.malId) > 0 && Number(pair.anilistId) > 0
  );
  for (let start = 0; start < usable.length; start += BATCH) {
    const chunk = usable.slice(start, start + BATCH);
    if (start > 0) await sleep(BATCH_DELAY_MS);
    const query = `query{${chunk
      .map((pair, index) => `a${index}:Media(id:${pair.anilistId},type:ANIME){idMal}`)
      .join(' ')}}`;
    try {
      const response = await fetcher(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) continue;
      const json = (await response.json()) as {
        data?: Record<string, { idMal?: number | null } | null>;
      };
      for (const [index, pair] of chunk.entries()) {
        const alias = `a${index}`;
        // AniList risponde per un id anche quando non lo conosce (`null`): è
        // un no definitivo, non un silenzio da riprovare.
        if (!json.data || !(alias in json.data)) continue;
        answered.add(pair.anilistId);
        const idMal = json.data[alias]?.idMal;
        if (Number(idMal) === pair.malId) confirmed.set(pair.anilistId, pair.malId);
      }
    } catch {
      // Rete o timeout: nessuna conferma da questo blocco, non è un errore fatale.
    }
  }
  return { confirmed, answered };
}
