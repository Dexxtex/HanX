// `paceHost` è una coda FIFO per host con pavimento 1 s: con 100 utenti sullo
// stesso host la coda cresceva senza tetto e l'ultima richiesta aspettava
// minuti, senza che nessuno la scartasse. Oltre il tetto si rifiuta subito.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { paceHost } = await import('../../dist/providers/anime-core/net-policy.js');

test('la coda per host rifiuta oltre il tetto invece di accumulare', async () => {
  const saved = process.env.ANIME_HOST_MIN_INTERVAL_MS;
  process.env.ANIME_HOST_MIN_INTERVAL_MS = '5';
  const host = 'queue-cap.test';
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  try {
    // Occupa lo slot: la prima non è in coda, è in esecuzione.
    const running = paceHost(host, () => gate);
    // 29 in coda portano la profondità a 30, cioè il tetto (tarato sui 30 s di
    // timeout del provider: 30 richieste x 1 s).
    const queued = [];
    for (let i = 0; i < 29; i += 1) queued.push(paceHost(host, async () => 'ok'));

    await assert.rejects(
      paceHost(host, async () => 'ok'),
      /coda satura/,
      'la trentunesima deve essere rifiutata subito, non accodata'
    );

    release();
    await running;
    await Promise.all(queued);

    // Il contatore non deve restare sporco dopo lo svuotamento.
    assert.equal(await paceHost(host, async () => 'dopo'), 'dopo');
  } finally {
    if (saved === undefined) delete process.env.ANIME_HOST_MIN_INTERVAL_MS;
    else process.env.ANIME_HOST_MIN_INTERVAL_MS = saved;
  }
});
