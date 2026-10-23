# HanX

**Addon Stremio/NUVIO dedicato agli anime** — aggrega stream da AnimeUnity, AnimeSaturn e AnimeWorld in un'unica interfaccia.

![Version](https://img.shields.io/badge/version-12.5.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20-green)
![Docker](https://img.shields.io/badge/docker-ready-blue)
![TypeScript](https://img.shields.io/badge/typescript-%3E5.0-blue)

## ⚡ Cosa fa

HanX è un addon per [Stremio](https://stremio.com) e [NUVIO](https://nuvio.app) che cerca e aggrega link di streaming per anime da tre fonti italiane:

- **AnimeUnity** — streaming diretto e proxy
- **AnimeSaturn** — streaming diretto e proxy
- **AnimeWorld** — streaming diretto e proxy

Supporta identificatori da **MyAnimeList**, **Kitsu**, **IMDb**, **TMDB** e **TVDB**.

## ✨ Features

- 🔍 Ricerca multi-provider con fallback automatico
- 🌐 Supporto EasyProxy per streaming affidabile
- 📺 HLS compatibile con player moderni
- ⚙️ Configurazione web integrata (`/`)
- 🐳 Docker ready con `docker compose`
- 🛡️ Logging con Winston + caching con SQLite

## 📦 Installazione

### Docker (consigliato)

```bash
git clone https://github.com/Dexxtex/HanX.git
cd HanX
cp .env.example .env
docker compose up -d
```

Se l'IPv4 pubblico viene rifiutato dai siti (403) mentre l'IPv6 funziona, su host Linux
aggiungi `network_mode: host` al servizio e togli la sezione `ports`.

### Manuale

```bash
pnpm install
cp .env.example .env # se .env non esiste già
pnpm start
```

Per lo sviluppo usa `pnpm dev`; entrambi i comandi caricano `.env` se presente.

## ⚙️ Configurazione

Variabili d'ambiente (`.env` o `docker-compose.yml`):

| Variabile | Descrizione | Default |
|-----------|-------------|---------|
| `PORT` | Porta del server | `7000` |
| `TMDB_API_KEY` | Chiave API TMDB per metadata e mapping | — |
| `TVDB_API_KEY` | Chiave API TVDB v4 per mapping/live fallback | — |
| `TVDB_PIN` | PIN TVDB (solo se richiesto dal progetto) | — |
| `ANIME_MAPPING_FILE` | Indice mapping alternativo | `src/mapping/data/anime-seasons.json` |
| `ANIME_MAPPING_OVERRIDES` | Override manuali del mapping | `src/mapping/overrides.json` |
| `ANIMEUNITY_ENABLED` | Abilita AnimeUnity | `true` |
| `ANIMESATURN_ENABLED` | Abilita AnimeSaturn | `true` |
| `ANIMEWORLD_ENABLED` | Abilita AnimeWorld | `true` |
| `DEBUG_LEVEL` | Debug 0-4: lifecycle, flow, details, trace | `0` |
| `EASYPROXY_URL` | URL base EasyProxy (es. `http://localhost:7860`) | — |
| `EASYPROXY_PASSWORD` | Password API EasyProxy (`API_PASSWORD`, opzionale) | — |
| `TENRAI_API_BASE_URL` | Base API metadata MAL/Tenrai | `https://api.tenrai.org/v1` |
| `TENRAI_CACHE_DB_PATH` | SQLite persistente per titoli/ETag e limiter | `./data/tenrai-metadata.sqlite` |
| `TENRAI_CACHE_TTL_MS` | Massima freshness locale, mai superiore al `max-age` upstream | `3600000` |
| `TENRAI_MAX_REQUESTS_PER_SECOND` / `TENRAI_MAX_REQUESTS_PER_MINUTE` | Limiti conservativi per l’IP di uscita | `3` / `100` |

Le righe `.env.example` configurano Tenrai e il mapping; puoi aggiungere le tue chiavi TMDB, TVDB o EasyProxy nello stesso `.env`. Docker Compose persiste il database nel volume `hanx-data`. Le credenziali restano locali e non vanno committate.

### URL pubblico dietro reverse proxy

La landing page costruisce il link del manifest usando l'origine pubblica rilevata dalla richiesta: `X-Forwarded-Host`, `X-Forwarded-Port`, `X-Forwarded-Proto` oppure `Host`. Se il proxy non passa queste informazioni, usa l'origine del browser. Non serve configurare manualmente host o porta.

### Dockhand / Git stack

Nel campo **Additional env file (optional)** lascia vuoto, a meno che tu non abbia davvero un secondo file nel repository (es. `.env.production`). Il campo accetta un nome relativo alla directory dello stack e non crea il file mancante.

Il `docker-compose.yml` rende `.env` opzionale e legge anche `.env.dockhand`, il file generato da Dockhand con le variabili non-secret dell'Environment tab. Le variabili secret vengono passate tramite le mappature `environment: ${VAR}` già presenti per chiavi API, EasyProxy e proxy di scraping. Non serve creare `.env` nel clone Git, ma puoi farlo se preferisci gestire tutto da file.

`EASYPROXY_URL` serve per la riproduzione degli stream, non per lo scraping: gli endpoint `/proxy/manifest.m3u8` e `/proxy/stream` non sono un forward proxy HTTP. Se AnimeUnity/AnimeSaturn/AnimeWorld rispondono `429` o `403`, configura un forward proxy HTTP/SOCKS in `PROXY` oppure nei proxy specifici `AU_PROXY`, `AS_PROXY`, `AW_PROXY`.

EasyProxy può comunque fornire il route di rete: se nel suo pannello abiliti WARP, NordVPN, WireGuard o Tor, esponi il relativo SOCKS5 e usalo come proxy di scraping, ad esempio `PROXY=socks5h://easyproxy:1080`. In Docker i due container devono essere sulla stessa rete, oppure il SOCKS5 deve essere pubblicato e raggiungibile dall'addon.

La landing page permette anche di inserire TMDB API Key, TVDB API Key e TVDB PIN direttamente nel link personale: se un campo resta vuoto, HanX usa la variabile d'ambiente corrispondente quando presente. Le chiavi non vengono salvate sul server e restano nel manifest URL.

Le variabili d'ambiente che hanno un campo corrispondente nel manifest (`TMDB_API_KEY`, `TVDB_API_KEY`, `TVDB_PIN`, `EASYPROXY_URL`, `EASYPROXY_PASSWORD`) precompilano la landing page e finiscono nel link generato. Non vengono aggiunte ai default del manifest pubblico. In self-host ogni istanza usa il proprio `.env`, quindi le chiavi precompilate sono quelle dell'utente che controlla quell'istanza. Se esponi la landing su Internet, proteggila con autenticazione.

### Mapping anime (solo fonti ufficiali)

Il livello `src/mapping/` risolve gli ID esterni verso una entry Kitsu usando esclusivamente API ufficiali:

- **Kitsu** (pubblico) per titoli, date di inizio e relazioni `sequel`/`prequel` (split cour/parti)
- **TMDB** per gli external ID e i film
- **TVDB v4** in **aired order** (`/episodes/default`) per serie e stagioni

L'indice locale `src/mapping/data/anime-seasons.json` viene caricato una volta e usato senza rete; ogni range contiene il titolo della entry Kitsu e il conteggio episodi, così split cour e richieste fuori range non finiscono sull'episodio sbagliato. In caso di miss, il resolver può interrogare le API ufficiali (con cache in memoria e retry su 429/5xx). I provider non usano più un resolver di path esterni: risolvono `{ titolo, stagione, episodio Kitsu }` e cercano per titolo. L'indice generato copre le serie; i film vengono risolti al volo via TMDB/IMDb + ricerca Kitsu (Kitsu non espone mapping TMDB/IMDb per i film).

> **L'indice spedito è vuoto.** Il mapping multi-stagione/split-cour richiede un indice generato (`pnpm mapping:build`) oppure entrambe le chiavi `TMDB_API_KEY` e `TVDB_API_KEY` per il fallback live. Senza di esse restano disponibili solo Kitsu e le ricerche per titolo; le richieste di stagioni successive non vengono forzate sul titolo base.

```bash
# richiede TMDB_API_KEY e TVDB_API_KEY
pnpm mapping:build            # rigenera l'indice (cache in .cache/anime-mapping/)
pnpm mapping:build -- --limit=50
pnpm mapping:check            # valida il JSON senza rete (avvisa se l'indice è vuoto)
pnpm mapping:verify           # check + test del mapping
```

EasyProxy resta un servizio esterno all'addon: avvialo, poi inserisci URL e password API nella configurazione web.

Interfaccia web: `http://localhost:7000/`

## 🔌 API

| Endpoint | Descrizione |
|----------|-------------|
| `/stream/anime/{id}.json` | Stream per anime |
| `/stream/film/{id}.json` | Stream per film |
| `/stream/serie/{id}.json` | Stream per serie |

ID supportati: `mal:123`, `kitsu:123`, `tt1234567`, `tmdb:12345`, `tvdb:12345`

## 📁 Struttura

```
HanX/
├── src/
│   ├── addon.ts            # Entry point
│   ├── landingPage.ts      # UI web
│   ├── mapping/            # Mapping ufficiale Kitsu/TMDB/TVDB
│   └── providers/          # Provider anime
├── config/                 # Configurazioni
├── Dockerfile
└── docker-compose.yml
```

## 🛠️ Sviluppo

```bash
pnpm install
pnpm run dev      # Avvio con hot-reload
pnpm run build    # Compilazione TypeScript
pnpm run check:domains  # Verifica domini provider
```

## ⚠️ Note

- Richiede **Node.js 20+**
- Le API esterne ufficiali (TMDB, TVDB, Kitsu) e Tenrai per i metadati MAL devono essere raggiungibili dal server
- EasyProxy è opzionale ma consigliato: https://github.com/realbestia1/EasyProxy

---

**HanX** — Anime streaming, semplificato.
