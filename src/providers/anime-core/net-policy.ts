/**
 * Politica di rete verso i siti: pacing per host e cooldown per host+uscita.
 *
 * Stava dentro `fetch-resource.ts`, mescolata al trasporto (agent, proxy, cache,
 * dedup, parsing). Sono due cose diverse: qui non si fa nessuna richiesta, si
 * decide **quando** e **se** una richiesta può partire.
 *
 * Il pacing è l'unica difesa contro il WAF, ed è anche il pavimento della
 * latenza: un episodio freddo costa 4 richieste per host, quindi il tempo di
 * risposta è ~4 × intervallo.
 */

// Un host alla volta, con un minimo tra due richieste: le raffiche (un titolo
// costa fino a 15 richieste in meno di un secondo) fanno scattare il WAF, e
// l'uscita condivisa si brucia.
const hostTails = new Map<string, Promise<unknown>>();
const hostLastAt = new Map<string, number>();

/**
 * Richieste al secondo per host. Il numero è la velocità: più alto = più veloce.
 *
 * Default 2, tetto 8 — l'8 è il massimo misurato (11/11/2026, rampa con stop al
 * primo 429 sulle pagine HTML): Saturn 12 req/s (50/50), World 12 (200/200),
 * Unity 8 (300/300; a 12 l'8,5% di 503, a 16 il 20-28%). Sopra 8 non si sale:
 * Unity è il collo di bottiglia e comincia a rifiutare.
 *
 * Il tetto è **per host, non per istanza**: quattro container sullo stesso IP a 2
 * req/s fanno gli 8 misurati. Chi ha una sola istanza può salire a 8.
 */
const MIN_HOST_RPS_FLOOR = 1;
const MIN_HOST_RPS_DEFAULT = 2;
const MIN_HOST_RPS_CEILING = 8;

/** Richieste al secondo dall'ambiente, intervallo in millisecondi dentro. */
function readRps(): number {
  const raw = String(process.env.ANIME_HOST_MAX_RPS ?? '').trim();
  if (!raw) return MIN_HOST_RPS_DEFAULT;
  const rps = Number(raw);
  if (!Number.isFinite(rps) || rps <= 0) return MIN_HOST_RPS_DEFAULT;
  return Math.min(MIN_HOST_RPS_CEILING, Math.max(MIN_HOST_RPS_FLOOR, rps));
}

/** Solo per i test: senza, ogni richiesta pagherebbe il pacing. */
let testOverride: number | null = null;
export function setMinHostIntervalMs(ms: number | null): void {
  testOverride = ms;
}

export function minHostIntervalMs(): number {
  if (testOverride !== null) return testOverride;
  return Math.round(1_000 / readRps());
}

/**
 * Oltre questa lunghezza la coda non smaltisce più: con 1 s di intervallo 30
 * richieste sono già 30 s di attesa, cioè il timeout del provider. Il tetto è
 * tarato su quel numero: più basso rifiuterebbe richieste che sarebbero andate
 * a buon fine.
 */
const MAX_QUEUE_PER_HOST = 30;
const queueDepth = new Map<string, number>();

/** Saturazione nostra, non un guasto del sito: non deve marcare il provider-run. */
export class QueueFullError extends Error {}

export function paceHost<T>(host: string, task: () => Promise<T>): Promise<T> {
  const interval = minHostIntervalMs();
  if (!host || interval === 0) return task();
  const depth = queueDepth.get(host) || 0;
  if (depth >= MAX_QUEUE_PER_HOST) {
    return Promise.reject(new QueueFullError(`coda satura per ${host}: ${depth} richieste in attesa`));
  }
  queueDepth.set(host, depth + 1);
  const previous = hostTails.get(host) || Promise.resolve();
  const run = previous.then(async () => {
    const wait = (hostLastAt.get(host) || 0) + interval - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    hostLastAt.set(host, Date.now());
    return task();
  });
  const settled = run.finally(() => {
    const left = (queueDepth.get(host) || 1) - 1;
    if (left <= 0) queueDepth.delete(host);
    else queueDepth.set(host, left);
  });
  // La coda non deve trascinare gli errori: la richiesta dopo parte comunque.
  hostTails.set(host, settled.catch(() => undefined));
  return settled;
}

// 403 = WAF, 429 = troppe richieste: insistere prolunga il blocco. Il cooldown
// è per host E uscita: un 403 via proxy non deve spegnere anche il diretto.
const blockedHosts = new Map<string, number>();
const BLOCK_403_MS = 10 * 60 * 1000;
const BLOCK_429_MS = 60 * 1000;

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** Chiave del cooldown: uscita + host. L'etichetta è solo un nome, non uno stato. */
export function exitKeyFor(exitLabel: string | undefined, host: string): string {
  return `${exitLabel || 'diretto'}:${host}`;
}

export function isCoolingDown(exitKey: string, now = Date.now()): boolean {
  return (blockedHosts.get(exitKey) || 0) > now;
}

/** Un 403 o un 429 mettono in pausa solo quell'uscita su quell'host. */
export function cooldownFor(exitKey: string, status: number, now = Date.now()): void {
  if (status === 403) blockedHosts.set(exitKey, now + BLOCK_403_MS);
  else if (status === 429) blockedHosts.set(exitKey, now + BLOCK_429_MS);
}

/**
 * Cooldown ancora attivi, per `/status.json`: "siamo sotto WAF, su quale uscita
 * e fino a quando" deve essere interrogabile, non dedotto dai log.
 */
export function cooldownSnapshot(now = Date.now()): { exitKey: string; untilMs: number }[] {
  const out: { exitKey: string; untilMs: number }[] = [];
  for (const [exitKey, until] of blockedHosts) {
    if (until > now) out.push({ exitKey, untilMs: until });
  }
  return out;
}
