# Regole per gli agenti

## Richieste verso siti esterni (Cloudflare)

Vale per ogni script, probe, batch o comando che propongo all'utente, non solo per il codice del repo.

- **Budget prima della richiesta.** Ogni output che tocca un sito esterno dichiara: numero di richieste, intervallo minimo, durata totale. Se il budget non sta sotto il limite noto del sito, non si propone.
- **Siti protetti da Cloudflare** (AnimeSaturn, AnimeWorld, AnimeUnity e in generale i siti di streaming): una richiesta alla volta, mai in parallelo.
- **Intervalli minimi:** 2 s per il traffico normale dei provider, 5 s per i probe diagnostici. Mai più di 30 richieste per probe: oltre, si spezza in blocchi con pausa.
- **Timeout esplicito** su ogni `fetch` (`AbortSignal.timeout`, 10-15 s). Nessuna richiesta senza timeout.
- **429:** una sola attesa (60 s) e un retry, poi stop. **403:** stop immediato, nessun retry: è il WAF, insistere prolunga il blocco.
- **Canary iniziale:** una richiesta nota prima del batch; se fallisce, non si parte.
- **Cache prima di tutto:** riusare i dati già in `data/.cache` (o le cache in memoria) invece di aggiungere richieste.
- **Limite sconosciuto:** si assume ~1 req/s come tetto teorico e si resta sotto (0,2 req/s per i batch). Un 429 osservato dimezza il budget della run successiva.

Precedente del 25/10/2026: 4 req/s sull'API di AnimeSaturn (50 titoli) → 429 in massa e poi 403 WAF. La stessa raccolta va fatta a 1 richiesta ogni 5 s, con canary e stop sul 403.
