# HanX

**Addon Stremio/NUVIO dedicato agli anime** — aggrega stream da AnimeUnity, AnimeSaturn e AnimeWorld in un'unica interfaccia.

![Version](https://img.shields.io/badge/version-12.5.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D24-green)
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

### Mapping anime (fonti ufficiali + Jikan locale)

Il livello `src/mapping/` risolve gli ID esterni verso una entry Kitsu usando esclusivamente API ufficiali:

- **Jikan** (la tua istanza self-hosted) come catalogo: quali anime esistono, titoli MAL, tipo e anno
- **Kitsu** (pubblico) per il collegamento MAL → Kitsu (`myanimelist/anime`) e per le relazioni `sequel`/`prequel` (split cour/parti)
- **TMDB** per trovare l'entry TMDB (titolo + anno) e da lì gli ID IMDb/TVDB
- **Kitsu mappings** `thetvdb/series` per le serie che TMDB non trova per titolo: è il fallback che copre i seguiti accorpati (`City Hunter 2` → `City Hunter`)
- **TVDB v4** in **aired order** (`/episodes/default`) per l'ordine episodi delle serie
- **ricerca TVDB per nome** (inglese, romaji, giapponese) come ultimo tentativo: match esatto o serie madre contenuta, anno ±1, un solo candidato

L'indice viene **costruito a piccoli passi** e cresce a ogni giro. Ogni run converte le prossime N entry del catalogo Jikan, le unisce all'indice esistente e salva il punto in cui è arrivato:

```bash
# una volta: Jikan raggiungibile e chiavi TMDB/TVDB presenti
docker exec HanX node scripts/build-anime-mapping.mjs --limit=200
```

Il cursore e l'esito di ogni entry stanno in `data/jikan-progress.json` (volume `hanx-data`): un run successivo riprende da lì e salta ciò che è già fatto. L'obiettivo è **una passata completa** (~14.000 entry TV + film): si lancia `--limit=0` (o si ripetono i batch finché `--status` non arriva a 100%), poi si smette. Le uscite nuove di MAL hanno id più alti e finiscono in fondo al catalogo: un `--limit=0` saltuario le prende senza rifare nulla. Il resto lo coprono già Tenrai (metadati MAL) e la risoluzione live.

| Comando | Effetto |
|---|---|
| `--limit=N` | converti N entry nuove in questo run (default 200) |
| `--limit=0` | tutto il catalogo rimanente |
| `--type=tv` / `--type=movie` | limita il batch a un solo tipo (senza flag: prima TV, poi film) |
| `--status` | percentuale per tipo + riepilogo del registro, senza scrivere nulla |
| `--publish` | al termine pubblica l'indice come asset della release (`GITHUB_TOKEN`) |
| `--retry=no-tmdb,no-align` | riapre le entry finite con quegli esiti e le riprocessa |
| `--retry-error` | scorciatoia per `--retry=error` |
| `--reset` | ignora indice e cursore esistenti |
| `--check` | valida il JSON senza rete |

Esempio di stato reale (catalogo 13.800 entry, passata completa del 24/10/2026, prima dell'ultimo retry):

```
tv     8725/8738 (100%)
movie  5050/5062 (100%)
registro: 13799/13800 entry (100%)
  ok 7248, already 1082, no-tmdb 1938, no-align 84, no-kitsu 3446, error 1
```

Prima del retry: 8.330 entry mappate su 13.799 (60,4%). Il retry finale (`--retry=error,no-tmdb,no-align`) ha riaperto 1.996 entry e ne ha recuperate 78 (3,9%): il tetto è raggiunto, perché il residuo non è un errore di match ma un buco di catalogo.

Esiti registrati per entry: `ok` (allineata su TVDB, o su TMDB quando TVDB manca), `already` (split cour già coperto), `no-kitsu` (Kitsu non ha il mapping MAL né un titolo corrispondente), `no-tmdb` (titolo non trovato né su TMDB né, per le serie, su TVDB), `no-align` (TVDB esiste ma senza episodi datati compatibili), `error` (rete). Restano fuori dall'indice `no-kitsu`, `no-tmdb`, `no-align` ed `error`: i primi tre sono buchi di catalogo, non errori di match — senza `kitsuId` l'indice non può indicare la stagione, quindi la risoluzione live non li recupera. Resta il fallback per titolo dei provider (TMDB/Tenrai), che non può però correggere gli offset di stagione.

Per le entry senza mapping MAL ufficiale il converter prova anche un match per metadati su Kitsu, volutamente severo: titolo normalizzato identico, stesso sottotipo (TV/film), anno ±1 e **un solo** candidato. Se i candidati sono due, meglio il buco: un id sbagliato manderebbe lo stream sulla serie sbagliata.

> **Cosa non si recupera (verificato il 24/10/2026).** Il residuo è 3.446 `no-kitsu` + 1.807 `no-tmdb` + 110 `no-align` (+1 errore di rete al momento del retry): buchi di catalogo, non match sbagliati. Rilanciare `--retry` non guadagna nulla; i ponti alternativi sono stati misurati e scartati:
>
> - **Film senza TMDB.** Kitsu non espone mapping `themoviedb` né `thetvdb/movie` (zero risultati), TVDB non registra id AniDB/AniList e `search/remoteid` risponde con titoli non correlati. Se un film non è su TMDB, Stremio non lo invia con un id mappabile.
> - **`no-kitsu` via AniList.** La catena MAL → AniList → Kitsu esiste (`anilist/anime` è un sito di mapping Kitsu), ma su un campione di 100 distribuito sul registro dà **0** kitsuId: 79 MAL id non hanno una entry AniList, e per i 21 che ce l'hanno Kitsu non ha il mapping AniList. AniDB non è attraversabile: Kitsu ha il sito `anidb`, ma né Jikan né AniList espongono un id AniDB da cui partire.
> - **Ancora MAL.** Salvare `{ malId, title }` per i 1.290 `no-kitsu` con `tmdbId` (824 film, 465 TV, 1 ONA) e togliere l'obbligo di `kitsuId` non aggiunge stream: sul miss i provider chiamano `getEnglishTitleFromAnyId`, che per un id TMDB/IMDB senza Kitsu usa già il titolo TMDB con stagione/episodio di Stremio, cioè lo stesso risultato che darebbe l'indice. Le 465 TV non hanno relazioni MAL: sarebbero stagioni singole, da verificare con l'allineamento date MAL↔TVDB per un guadagno non dimostrato.

L'indice locale `src/mapping/data/anime-seasons.json` (o il percorso in `ANIME_MAPPING_FILE`) viene caricato una volta e usato senza rete; ogni range contiene il titolo della entry Kitsu e il conteggio episodi, così split cour e richieste fuori range non finiscono sull'episodio sbagliato. In caso di miss, il resolver può interrogare le API ufficiali (con cache in memoria e retry su 429/5xx). I provider non usano più un resolver di path esterni: risolvono `{ titolo, stagione, episodio Kitsu }` e cercano per titolo.

> **L'indice spedito è vuoto.** Il mapping multi-stagione/split-cour richiede l'indice incrementale qui sopra oppure entrambe le chiavi `TMDB_API_KEY` e `TVDB_API_KEY` per il fallback live.

#### Dove gira

Il converter deve raggiungere la tua istanza Jikan, quindi gira **sul server**, non su GitHub Actions. Nel container:

```yaml
environment:
  - JIKAN_API_BASE=http://jikan_rest:8080/v4
  - ANIME_MAPPING_FILE=/app/data/anime-seasons.json
  - ANIME_MAPPING_STATE=/app/data/jikan-progress.json
```

Se Jikan è in un'altra stack Docker, aggiungi la sua rete al servizio (una volta):

```yaml
services:
  hanx:
    networks: [default, jikan]
networks:
  jikan:
    external: true
    name: jikan_default
```

La stack Jikan completa (compose, segreti, indici Mongo/Typesense, seed, patch RoadRunner)
è in [`docs/jikan-self-hosted.md`](docs/jikan-self-hosted.md).

Poi i batch si lanciano dalla shell di Dockhand:

```bash
docker exec HanX node scripts/build-anime-mapping.mjs --limit=200
```

L'addon ricarica l'indice quando il file cambia (mtime): nessun riavvio necessario.

#### Pubblicazione su GitHub

Il repo non è il posto giusto per l'indice (crescerebbe di MB a ogni batch): va come **asset di una release**, con URL stabile e CDN.

1. Crea un token fine-grained con `contents: write` sul repo, poi mettilo in `.env`:

```bash
GITHUB_TOKEN=github_pat_...
GITHUB_REPO=Dexxtex/HanX          # opzionale, è il default
```

2. Aggiungi `--publish` al batch:

```bash
docker exec HanX node scripts/build-anime-mapping.mjs --limit=200 --type=tv --publish
```

La prima volta crea la release `mapping`, poi sostituisce l'asset `anime-seasons.json`:

```
https://github.com/Dexxtex/HanX/releases/download/mapping/anime-seasons.json
```

Su un'altra installazione (mini PC, amici) basta:

```bash
ANIME_MAPPING_URL=https://github.com/Dexxtex/HanX/releases/download/mapping/anime-seasons.json
ANIME_MAPPING_TOKEN=github_pat_...   # solo se il repo è privato
```

**Il repo `Dexxtex/HanX` oggi è privato**, e gli asset di un repo privato non si scaricano senza autenticazione: serve un secondo token fine-grained con **Contents: read** sul client (o rendere pubblico il repo e togliere la riga `ANIME_MAPPING_TOKEN`). Sul server che pubblica il token di scrittura basta; il client può usare uno read-only.

L'addon scarica l'indice al primo avvio e lo ricontrolla ogni 24h con ETag; se il download fallisce tiene il file precedente. La sostituzione dell'asset lascia una finestra di ~1 secondo in cui l'URL non risponde: irrilevante, perché il client in quel caso continua col file locale. Se il token manca o è scaduto, il batch viene salvato lo stesso e `--publish` esce con errore (il cron te lo segnala).

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
├── scripts/                # Converter del mapping e utility
├── docs/                   # Guide (es. Jikan self-hosted)
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

- Richiede **Node.js 24+** (`node:sqlite` è usato per la cache Tenrai)
- Le API esterne ufficiali (TMDB, TVDB, Kitsu) e Tenrai per i metadati MAL devono essere raggiungibili dal server
- EasyProxy è opzionale ma consigliato: https://github.com/realbestia1/EasyProxy

---

**HanX** — Anime streaming, semplificato.
