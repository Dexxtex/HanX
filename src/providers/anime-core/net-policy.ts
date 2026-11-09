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

/** Letto a ogni chiamata: i test lo azzerano senza toccare il resto. */
export function minHostIntervalMs(): number {
  const raw = process.env.ANIME_HOST_MIN_INTERVAL_MS;
  // Solo il letterale `0` spegne il pacing. Una variabile vuota o con un typo
  // non deve poter togliere la protezione che è costata un 403.
  if (raw === undefined || !raw.trim()) return 1000;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1000;
}

export function paceHost<T>(host: string, task: () => Promise<T>): Promise<T> {
  const interval = minHostIntervalMs();
  if (!host || interval === 0) return task();
  const previous = hostTails.get(host) || Promise.resolve();
  const run = previous.then(async () => {
    const wait = (hostLastAt.get(host) || 0) + interval - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    hostLastAt.set(host, Date.now());
    return task();
  });
  // La coda non deve trascinare gli errori: la richiesta dopo parte comunque.
  hostTails.set(host, run.catch(() => undefined));
  return run;
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
