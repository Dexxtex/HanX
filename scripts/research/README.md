# Sonde di ricognizione

Script usati per la ricognizione dei tre siti (novembre 2026). **Non girano in CI**:
fanno richieste reali e servono solo a rifare una misura a mano.

| script | cosa fa |
|---|---|
| `sonde-path.mjs` | elenca i path noti dei tre siti e il loro esito (~8 richieste, 5 s) |
| `unity-api.mjs` | interroga `POST /archivio/get-animes` con filtri e stampa `tot`/campi di un record |
| `copertura-latin.mjs` | misura la copertura del catalogo separando titoli latini e CJK (`CATALOG_DIR=./data`) |
| `extra-metadati.mjs` | cerca nei tre siti i dati non ancora usati: `lastmod` delle sitemap, id MAL/AniList sulle schede, `data-jtitle` delle card, campi del record Unity (11 richieste) |

Tutti rispettano le regole del repo: una richiesta alla volta, 5 s di distanza,
User-Agent esplicito, timeout, stop sul 403. I risultati e le conclusioni sono in
[`../../docs/provider-catalog-research.md`](../../docs/provider-catalog-research.md).
