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
  rateLimited?: boolean;
}

/**
 * Una richiesta per blocco, con il dimezzamento sul 404.
 *
 * AniList risponde 404 per **tutto il blocco** quando un solo id non esiste, e
 * azzera anche i validi. Quindi sul 404 il blocco si divide in due finché resta
 * un id: quello è il colpevole e si marca come risposto (esito definitivo), le
 * metà che rispondono tengono le loro conferme.
 */
async function queryPairs(
  pairs: { malId: number; anilistId: number }[],
  fetcher: typeof fetch,
  out: MalIdCheck,
  pause: () => Promise<void>
): Promise<void> {
  if (!pairs.length) return;
  const query = `query{${pairs
    .map((pair, index) => `a${index}:Media(id:${pair.anilistId},type:ANIME){idMal}`)
    .join(' ')}}`;
  await pause();
  let response: Response;
  try {
    response = await fetcher(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // Rete o timeout: nessun esito da questo blocco, non è un errore fatale.
    return;
  }
  if (response.status === 404) {
    if (pairs.length === 1) {
      // Un id solo che risponde 404: AniList non lo conosce. Esito definitivo,
      // altrimenti quella scheda resta in testa alla coda per sempre.
      out.answered.add(pairs[0].anilistId);
      return;
    }
    const middle = Math.ceil(pairs.length / 2);
    await queryPairs(pairs.slice(0, middle), fetcher, out, pause);
    await queryPairs(pairs.slice(middle), fetcher, out, pause);
    return;
  }
  if (response.status === 429) {
    out.rateLimited = true;
    const retryHeader = response.headers?.get ? response.headers.get('retry-after') : null;
    const retryAfter = Number(retryHeader);
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      await sleep(Math.min(retryAfter * 1000, 60_000));
    }
    return;
  }
  if (!response.ok) return; // 5xx/altri: silenzio, non si moltiplicano le richieste
  const json = (await response.json()) as {
    data?: Record<string, { idMal?: number | null } | null>;
  };
  for (const [index, pair] of pairs.entries()) {
    const alias = `a${index}`;
    // AniList risponde per un id anche quando non lo conosce (`null`): è un no
    // definitivo, non un silenzio da riprovare.
    if (!json.data || !(alias in json.data)) continue;
    out.answered.add(pair.anilistId);
    const idMal = json.data[alias]?.idMal;
    if (Number(idMal) === pair.malId) out.confirmed.set(pair.anilistId, pair.malId);
  }
}

/**
 * Coppie (anilistId → malId) che AniList conferma, e gli id per cui ha risposto
 * davvero. Un 429, un 5xx o un errore di rete non confermano e non rispondono:
 * quelle schede restano senza `malId` e si riprovano alla run successiva, mentre
 * una risposta con `idMal` null o diverso è un esito definitivo.
 */
export async function confirmMalIds(
  pairs: CardIds[],
  fetcher: typeof fetch = fetch,
  /** Pausa fra le richieste: 0 nei test, il default rispetta il tetto di AniList. */
  options: { delayMs?: number } = {}
): Promise<MalIdCheck> {
  const delayMs = options.delayMs ?? BATCH_DELAY_MS;
  const confirmed = new Map<number, number>();
  const answered = new Set<number>();
  const usable = pairs.filter(
    (pair): pair is { malId: number; anilistId: number } =>
      Number(pair.malId) > 0 && Number(pair.anilistId) > 0
  );
  // Una pausa prima di ogni richiesta, tranne la prima: vale anche per le
  // richieste extra del dimezzamento, che altrimenti arriverebbero a raffica.
  let first = true;
  const pause = async () => {
    if (!first) await sleep(delayMs);
    first = false;
  };
  for (let start = 0; start < usable.length; start += BATCH) {
    const check: MalIdCheck = { confirmed, answered };
    await queryPairs(usable.slice(start, start + BATCH), fetcher, check, pause);
    if (check.rateLimited) {
      break;
    }
  }
  return { confirmed, answered };
}
