# 🏗️ Architettura Completa — HanX Addon

> **Versione documento**: 1.0  
> **Ultimo aggiornamento**: 2026-10-11  
> **Addon**: HanX v12.4.23 — `org.stremio.hanx`

---

## 📋 Indice

1. [Panoramica](#1-panoramica)
2. [Flusso Richiesta Completo](#2-flusso-richiesta-completo)
3. [Struttura del Progetto](#3-struttura-del-progetto)
4. [Entrypoint & Server](#4-entrypoint--server)
5. [Manifest & Configurazione](#5-manifest--configurazione)
6. [ID System](#6-id-system)
7. [Provider Anime](#7-provider-anime)
8. [Anime-Core (Infrastruttura Condivisa)](#8-anime-core-infrastruttura-condivisa)
9. [Estrazione Stream](#9-estrazione-stream)
10. [Normalizzazione Titoli](#10-normalizzazione-titoli)
11. [Config Parsing System](#11-config-parsing-system)
12. [Provider Cache System](#12-provider-cache-system)
13. [Streaming Backend](#13-streaming-backend)
14. [VixSrc Proxy Fallback System](#14-vixsrc-proxy-fallback-system)
15. [VixSynthetic Endpoint (HLS Master Playlist Rewriter)](#15-vixsynthetic-endpoint-hls-master-playlist-rewriter)
16. [MediaFlow Proxy](#16-mediaflow-proxy)
17. [VixCloud / Streamtape Extraction](#17-vixcloud--streamtape-extraction)
18. [Unificazione Stream](#18-unificazione-stream)
19. [Caching](#19-caching)
20. [AnimeGate (Rilevamento Anime)](#20-animegate-rilevamento-anime)
21. [Title Resolver (Kitsu / MAL / TMDB / IMDB)](#21-title-resolver)
22. [Landing Page & UI](#22-landing-page--ui)
23. [DNS Safety & Security](#23-dns-safety--security)
20. [Workflow GitHub Automations](#20-workflow-github-automations)
21. [Docker & Deployment](#21-docker--deployment)

---

## 1. Panoramica

**HanX** è un addon per [Stremio](https://stremio.com) e [NUVIO](https://nuvio.app) dedicato esclusivamente agli anime. Aggrega link di streaming da tre fonti italiane:

| Provider | Sito | Protocollo |
|----------|------|------------|
| **AnimeUnity** | animeunity.so | Scraper HTML + Mapping API + VixCloud |
| **AnimeSaturn** | animesaturn.cx | Scraper HTML + Kitsu fallback |
| **AnimeWorld** | animeworld.so | Scraper HTML + Mapping API |

### Cosa fa l'addon:
1. Riceve un ID (MAL, Kitsu, IMDB, TMDB) da Stremio
2. Risolve il titolo dell'anime usando API esterne (Jikan, Kitsu, TMDB, Haglund)
3. Cerca lo stream su **tutti e tre i provider** in parallelo
4. Estrae i link video dai player embedding (VixCloud, Mixdrop, Streamtape, ecc.)
5. Offre 3 modalità di streaming: **Direct**, **Proxy (EasyProxy)**, **MediaFlow Proxy**
6. Unifica e ordina tutti gli stream in una risposta Stremio-compliant

---

## 2. Flusso Richiesta Completo

```
Stremio/NUVIO
    │
    ▼ /stream/anime/{id}.json
    │
    ├─> ID Parsing (ttXXX, mal:XXX, kitsu:XXX, tmdb:XXX)
    │
    ├─> Config Resolution (requestConfig > env vars > defaults)
    │
    ├─> Provider Cache Check (SHA-256 key)
    │     └─ HIT → Ritorna stream cached
    │     └─ MISS → Continua
    │
    ├─> AnimeGate (è un anime? → sì/no)
    │     └─ Se no → fallback TMDB generico
    │
    ├─> Title Resolution
    │     ├─ kitsu:XXX → Kitsu API → titolo + MAL ID
    │     ├─ mal:XXX  → Jikan API → titolo inglese
    │     ├─ ttXXX    → TMDB Find (IMDB→TMDB) → titolo + TMDB ID
    │     └─ tmdb:XXX → TMDB API → titolo
    │
    ├─> Fan-out Providers (parallelo, timeout 30s ciascuno)
    │     ├─ AnimeUnity Provider
    │     ├─ AnimeSaturn Provider
    │     └─ AnimeWorld Provider
    │           │
    │           ▼ Per ogni provider:
    │           ├─ handleTitleRequest()
    │           │   ├─ Universal Title Normalization
    │           │   ├─ Provider Title Normalization
    │           │   ├─ Search on provider site
    │           │   ├─ Filter results
    │           │   └─ Extract episodes
    │           │
    │           └─ extractStreamsFromAnimePath()
    │               ├─ Parse episode page
    │               ├─ Resolve video URL
    │               └─ Build stream objects
    │
    ├─> Post-Processing
    │     ├─ unifyStreams() — formatta titoli multilinea
    │     ├─ sortStreamsByPriority() — ordinamento alfabetico
    │     └─ Provider ordering — AnimeUnity > AnimeSaturn > AnimeWorld
    │
    ├─> Provider Cache Write
    │
    └─> Response { streams: [...] }
```

---

## 3. Struttura del Progetto

```
HanX/
├── src/
│   ├── addon.ts                  # Entry point principale (500+ righe)
│   ├── extractor.ts              # VixCloud/stream extraction (900+ righe)
│   ├── landingPage.ts            # UI web di configurazione
│   ├── stremio-addon-sdk.d.ts    # Type definitions SDK
│   │
│   ├── config/
│   │   └── imdbToTmdb.json       # Mapping statico IMDB→TMDB
│   │
│   ├── providers/
│   │   ├── anime-core/           # Infrastruttura condivisa
│   │   │   ├── index.ts          # Barrel export
│   │   │   ├── cache.ts          # TTL cache + inflight dedup
│   │   │   ├── fetch-resource.ts # HTTP fetch con cache
│   │   │   ├── helpers.ts        # Sanitize, inferSourceTag, parseEpisode
│   │   │   ├── mapping-api.ts    # Mapping API interaction
│   │   │   └── provider-urls.ts  # Dynamic URL resolution
│   │   │
│   │   ├── animesaturn-provider.ts  # ~1400 righe
│   │   ├── animeunity-provider.ts   # ~1300 righe
│   │   ├── animeworld-provider.ts   # ~1500 righe
│   │   ├── kitsu.ts                 # Wrapper API Kitsu
│   │   └── flaresolverr.ts          # Cloudflare bypass
│   │
│   ├── types/
│   │   ├── animeunity.ts          # Interfacce TypeScript
│   │   └── sax.d.ts               # SAX parser types
│   │
│   └── utils/
│       ├── animeGate.ts           # Rilevamento anime (TMDB/Jikan)
│       ├── animeTitleResolver.ts  # Risoluzione titoli da ID esterni
│       ├── config.ts
│       ├── domains.ts             # Dynamic domain resolution
│       ├── mediaflow.ts           # MediaFlow URL formatting
│       ├── packed.ts
│       ├── tmdbResolver.ts        # IMDB→TMDB resolution
│       └── unifiedNames.ts        # Stream name formatting
│
├── config/
│   ├── domains.json               # Domini provider (aggiornabili)
│   ├── provider_urls.json         # URL provider (aggiornabili)
│   └── addon-config.json          # Config overrides
│
├── scripts/                       # Build e automazioni
├── public/                        # Assets statici
├── Dockerfile
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.json
```

---

## 4. Entrypoint & Server

### `src/addon.ts` — Il Cuore

**Responsabilità:**
- Definizione del manifest Stremio
- Creazione del builder SDK
- Handler per risorse `stream` e `meta`
- Parsing della configurazione
- Fan-out dei provider
- Unificazione e ordinamento degli stream
- Server Express per endpoint custom e landing page

**Flusso `createBuilder()`:**
1. Carica manifest (da config custom o base)
2. Definisce `defineMetaHandler` — ritorna `null` (placeholder)
3. Definisce `defineStreamHandler` — logica principale
4. Espone router Express su `/stream/*`
5. Avvia server sulla porta configurata

**Server Express:**
```typescript
const app = express();
// Middleware: parsing config da query params / body
// Router: /stream/:type/:id.json
// Landing page: GET /
```

### `src/extractor.ts` — Estrattore Video

**Responsabilità:**
- Estrazione stream da VixCloud e altri host
- Gestione proxy MediaFlow / EasyProxy
- Parsing playlist HLS
- Risoluzione URL video finali
- Costruzione stream sintetici (FHD)

**Funzioni chiave:**
| Funzione | Scopo |
|----------|-------|
| `getUrl()` | Costruisce URL target dal tipo/id |
| `getStreamContent()` | Estrae tutti gli stream possibili |
| `getDirectStream()` | Modalità direct (senza proxy) |
| `getProxyStream()` | Modalità proxy MediaFlow |
| `buildSyntheticBase()` | Crea stream sintetici FHD |
| `buildSyntheticProxyWrapper()` | Wrapper proxy per sintetici |
| `finalize()` | Formatta stream finali con nomi unificati |
| `finalizeAndFilter()` | Applica filtri e deduplica |

---

## 5. Manifest & Configurazione

### Manifest Base

```json
{
  "id": "org.stremio.hanx",
  "version": "12.4.23",
  "name": "HanX | Elfhosted",
  "types": ["movie", "series", "anime"],
  "idPrefixes": ["tt", "kitsu", "mal", "tmdb"],
  "resources": ["stream", "meta"],
  "behaviorHints": { "configurable": true }
}
```

### Config UI (10 campi)

| Chiave | Tipo | Default | Descrizione |
|--------|------|---------|-------------|
| `tmdbApiKey` | text | — | Chiave API TMDB |
| `mediaFlowProxyUrl` | text | — | URL MediaFlow Proxy |
| `mediaFlowProxyPassword` | text | — | Password MediaFlow |
| `useMediaFlow` | checkbox | false | Usa MediaFlow (vs EasyProxy) |
| `animeunityEnabled` | checkbox | true | Abilita AnimeUnity |
| `animeunityDirect` | checkbox | — | Direct locale |
| `animeunityDirectFhd` | checkbox | — | Synthetic FHD locale |
| `animeunityProxy` | checkbox | — | Proxy cross-IP |
| `animesaturnEnabled` | checkbox | true | Abilita AnimeSaturn |
| `animeworldEnabled` | checkbox | true | Abilita AnimeWorld |

### Risoluzione Configurazione (Priorità)

```
1. requestConfig (da UI Stremio)
2. Env vars (MFP_URL, MFP_PSW, ecc.)
3. Defaults hardcoded
```

---

## 6. ID System

### Formati Supportati

| Formato | Esempio | Descrizione |
|---------|---------|-------------|
| **Kitsu** | `kitsu:12345` | ID Kitsu anime |
| **Kitsu + Ep** | `kitsu:12345:5` | Kitsu + episodio |
| **Kitsu + S/E** | `kitsu:12345:2:5` | Kitsu + stagione + episodio |
| **MAL** | `mal:12345` | ID MyAnimeList |
| **IMDB** | `tt1234567` | ID IMDb (movie) |
| **IMDB + S/E** | `tt1234567:1:5` | IMDb + stagione + episodio |
| **TMDB** | `tmdb:12345` | ID TMDB (movie) |
| **TMDB + S/E** | `tmdb:12345:2:5` | TMDB + stagione + episodio |

### Parsing nel Stream Handler

```typescript
// Kitsu/MAL → passati direttamente ai provider
// IMDB → convertito a TMDB via TMDB Find API
// TMDB → usato per lookup mapping API
```

---

## 7. Provider Anime

### 7.1 AnimeUnity Provider

**File:** `src/providers/animeunity-provider.ts` (~1300 righe)

**Metodi di ingresso:**
| Metodo | ID Supportato |
|--------|--------------|
| `handleKitsuRequest()` | `kitsu:XXX` |
| `handleMalRequest()` | `mal:XXX` |
| `handleImdbRequest()` | `ttXXX` |
| `handleTmdbRequest()` | `tmdb:XXX` |

**Flusso:**
1. Risolve titolo da Kitsu/MAL/TMDB
2. Cerca su Mapping API (se disponibile) per percorsi diretti
3. Fallback: ricerca titolo su sito AnimeUnity
4. Estrae pagine episodio
5. Risolve video da player embed

**Modalità streaming:**
- `Direct` — accesso diretto (locale, IP-bound)
- `DirectFHD` — versione synthetica Full HD
- `Proxy` — via EasyProxy (cross-IP)

### 7.2 AnimeSaturn Provider

**File:** `src/providers/animesaturn-provider.ts` (~1400 righe)

**Differenze da AnimeUnity:**
- Non usa Mapping API (usa ricerca diretta)
- Ha fallback Kitsu integrato
- Supporta `CR ITA` (Crunchyroll Italia) detection
- Filtraggio risultati più aggressivo (`filterAnimeResults`)

**Flusso:**
1. `handleTitleRequest()` → normalizza titolo
2. `searchAllVersions()` → cerca su AnimeSaturn
3. `filterAnimeResults()` → filtra per similarità titolo
4. Estrae pagine episodio → risolvi stream

### 7.3 AnimeWorld Provider

**File:** `src/providers/animeworld-provider.ts` (~1500 righe)

**Differenze:**
- Usa Mapping API + fallback ricerca
- Ha `exactMap` separata con `resolveExactMapKey()`
- Supporta `strict base slug filter` per filtraggio
- Ha `fallbackFilterYearSearch` basato su data Kitsu
- Language detection più sofisticata (`playLangCache`)

**Flusso:**
1. `handleTitleRequest()` → normalizza + cerca exactMap
2. `searchWithLogging()` → cerca su AnimeWorld
3. `strict base filter` → filtra per slug
4. `fallbackFilterYearSearch()` → fallback per anno
5. Estrae stream → language detection

---

## 8. Anime-Core (Infrastruttura Condivisa)

### 8.1 Cache (`cache.ts`)

```typescript
interface CacheEntry<T> {
  value: T;
  expiresAt: number;  // TTL-based expiration
}
```

**Funzioni:**
- `getCached(map, key)` — legge con auto-pruning
- `setCached(map, key, value, ttlMs)` — scrive con expiry
- `uniqueStrings(values)` — deduplica array
- `createCaches()` — crea set di cache per provider

### 8.2 Fetch Resource (`fetch-resource.ts`)

**Caratteristiche:**
- TTL cache su HTTP responses
- **Inflight deduplication** — richieste duplicate condividono stessa Promise
- Timeout configurabile (`ANIME_FETCH_TIMEOUT_MS`, default 10s)
- Proxy auto-detection per provider (AU/AS/AW)
- User-Agent configurabile per provider

**Flusso `fetchResource()`:**
```
1. Check TTL cache → se hit, ritorna
2. Check inflight map → se running, attendi
3. Esegui fetch con proxy/timeout
4. Salva in cache se ttl > 0
5. Rimuovi da inflight
```

### 8.3 Provider URLs (`provider-urls.ts`)

**Risoluzione URL in 3 step:**
1. **Local JSON** (`provider_urls.json`) — reload ogni 1.5s
2. **Remote JSON** (GitHub raw) — refresh ogni 10s
3. **Env vars** — fallback finale

**Alias supportati:**
```
animeunity → animeunuty, anime_unity
animeworld → anime_world
animesaturn → anime_saturn
mapping_api → mappingapi, mapping_api_url, mapping_url
```

### 8.4 Mapping API (`mapping-api.ts`)

**Interazione con API di mapping esterna** (easystreams-style):

```
GET {mappingApiBase}/{provider}/{externalId}?ep={episode}&s={season}&lang={it|default}
```

**Funzioni:**
- `parseExplicitRequestId()` — parse ID da stringa
- `resolveLookupRequest()` — build lookup da ID + contesto
- `fetchMappingPayload()` — fetch con cache 2min TTL
- `extractProviderPaths()` — estrai percorsi provider dal payload
- `resolveEpisodeFromMappingPayload()` — risolvi numero episodio

### 8.5 Helpers (`helpers.ts`)

**Funzioni condivise:**
| Funzione | Scopo |
|----------|-------|
| `sanitizeAnimeTitle()` | Pulisce suffissi provider e marker lingua |
| `inferSourceTag()` | Rileva ITA vs SUB dal titolo/pat |
| `resolveLanguageEmoji()` | Mappa source tag → emoji bandiera |
| `parsePositiveInt()` | Parse sicuro intero positivo |
| `normalizeRequestedEpisode()` | Normalizza numero episodio |
| `normalizeRequestedSeason()` | Normalizza numero stagione |
| `parseEpisodeNumber()` | Estrae numero da stringa episodio |
| `toAbsoluteUrl()` | Converte episodio numerico in assoluto |
| `collectMediaLinksFromEmbedHtml()` | Estrae link da HTML embed |
| `BLOCKED_DOMAINS` | Lista domini bloccati per sicurezza |

---

## 9. Estrazione Stream

### 9.1 Pipeline di Estrazione

```
AnimePage (HTML)
    │
    ▼ parseVideoPlayerJson()
    │
    ├─> embed_url → Player iframe
    ├─> mp4_url → Direct MP4
    └─> episode_page → Episode detail page
          │
          ▼ Episode Page HTML
          │
          ├─> Video sources (MP4/M3U8)
          ├─> Embed URLs (VixCloud, Mixdrop, ecc.)
          └─> Play URLs (redirect a player)
```

### 9.2 Player Extraction

**VixCloud / Mixdrop / Streamtape / Doodstream / ecc.**

L'extractor (`extractor.ts`) gestisce:
1. Fetch pagina embed con headers anti-bot
2. Parsing HTML con Cheerio
3. Estrazione token/auth da script tags
4. Costruzione URL stream finale
5. Supporto HLS (`.m3u8`) con parsing playlist

### 9.3 Proxy Modes

| Modalità | Descrizione | Uso |
|----------|-------------|-----|
| **Direct** | Accesso diretto al video | Locale, IP-bound |
| **Proxy (EasyProxy)** | Via proxy intermedio | Cross-IP, consigliato |
| **MediaFlow** | Via MediaFlow Proxy | Avanzato, con password |

---

### 9.4 Estrattore Video (`extractor.ts`)

**File:** `src/extractor.ts` (~1600 righe)

#### 9.4.1 Interfacce

```typescript
interface ExtractorConfig {
  tmdbApiKey?: string;
  mfpUrl?: string;
  mfpPsw?: string;
  useMediaFlow?: boolean;
  vixLocal?: boolean;
  addonBase?: string;
  vixDual?: boolean;
  vixDirect?: boolean;
  vixDirectFhd?: boolean;
  vixProxy?: boolean;
  vixProxyFhd?: boolean;
}

interface VixCloudStreamInfo {
  name: string;
  streamUrl: string;
  referer: string;
  source: 'proxy' | 'direct';
  sizeBytes?: number;
  isSyntheticFhd?: boolean;
  originalName?: string;
  detectedLang?: string;
}
```

#### 9.4.2 Funzioni Principali

| Funzione | Scopo |
|----------|-------|
| `getUrl()` | Costruisce URL target VixSrc dal tipo/id |
| `getStreamContent()` | Estrae tutti gli stream possibili (direct+proxy+synthetic) |
| `getDirectStream()` | Modalità direct — token extraction da embed page |
| `getProxyStream()` | Modalità proxy — costruzione URL MediaFlow/EasyProxy |
| `buildSyntheticBase()` | Crea stream sintetico FHD via /vixsynthetic.m3u8 |
| `buildSyntheticProxyWrapper()` | Wrapper proxy per stream sintetico |
| `parseManifestLanguages()` | Rileva lingue audio da master HLS |
| `fetchVixCloudSiteVersion()` | Ottiene versione site per X-Inertia header |
| `checkUrlExists()` | Verifica se URL esiste via HEAD request |

#### 9.4.3 Token Extraction Pipeline

```
1. Fetch embed page (con X-Inertia header)
2. Parse HTML con Cheerio
3. Trova script con 'token' e 'expires'
4. Estrai: token, expires, serverUrl
5. Rileva FHD: window.canPlayFHD = true
6. Costruisci URL: /playlist/{id}?b=1&token={t}&expires={e}&h=1
7. Rileva lingue: parseManifestLanguages(masterUrl)
```

#### 9.4.4 URL Master Playlist Normalization

Parametri preservati (ordine):
1. `b=1` — se presente nell'originale
2. `token` — token di autenticazione
3. `expires` — timestamp scadenza
4. `h=1` — flag FHD

---

### 9.5 FlareSolverr Integration

**File:** `src/providers/flaresolverr.ts`

#### 9.5.1 Scopo

Bypass Cloudflare challenge per provider che usano protezione Cloudflare.

#### 9.5.2 Caratteristiche

- **Cache HTTP** — TTL 15min per status 200
- **Challenge Detection** — rileva `cf-turnstile`, `__cf_chl_`, "Just a moment"
- **Proxy Fallback** — tenta proxy alternativo se primary bloccato
- **Cookie Persistence** — salva `cf_clearance` per host
- **User-Agent Rotation** — memorizza UA per host
- **Retry su 5xx** — max 1 retry

#### 9.5.3 Error Mapping

| Status | Errore |
|--------|--------|
| 404 | `not_found` |
| 403 / challenge | `cloudflare_challenge` |
| 429 | `too_many_requests` |
| 451 | `cloudflare_censor` |
| 5xx | retry |

#### 9.5.4 Stream Cache

Cache file-based su `config/mostraguarda_cache.json` per risultati stream.

---

### 9.6 Scripts Directory

**File:** `scripts/`

| Script | Scopo |
|--------|-------|
| `auto_normalize.py` | Genera PR per AnimeSaturn normalizzazioni |
| `auto_normalize_animeunity.py` | Genera PR per AnimeUnity normalizzazioni |
| `auto_normalize_animeworld.py` | Genera PR per AnimeWorld normalizzazioni |
| `build-copy.js` | Copia assets durante build |
| `check_domains.cjs` | Verifica domini provider |
| `update_domains.py` | Aggiorna domini provider |

---

## 10. Normalizzazione Titoli

### 10.1 Pipeline di Normalizzazione

```
Titolo Input
    │
    ▼ [1] Universal Title Normalization
    │   (animeGate.ts — condiviso)
    │   One-Punch Man → One Punch Man
    │   Season 2/3 handling
    │
    ▼ [2] Provider Title Normalization
    │   (normalizeTitleForSearch — per-provider)
    │   exactMap → mappatura precisa
    │   genericMap → sostituzioni generiche
    │
    ▼ [3] Unicode → ASCII
    │   (normalizeUnicodeToAscii)
    │   ' → ' (apostrofi smart)
    │   : → : (due punti Unicode)
    │
    ▼ Ricerca su Provider
    │
    ▼ [4] Filter Results
    │   (filterAnimeResults — AnimeSaturn)
    │   Similarità titolo normalizzato
    │
    ▼ [5] Sanitize Output
    │   (sanitizeAnimeTitle)
    │   Rimuove suffissi e marker
```

### 10.2 Confronto Provider

| Feature | AnimeUnity | AnimeSaturn | AnimeWorld |
|---------|-----------|-------------|------------|
| Exact Map | ~1 voce | ~25 voci | ~10 voci |
| Generic Map | Nessuna | 3 voci | Nessuna |
| Replacements | 4 (case-insensitive) | 3 (case-sensitive) | 5 (case-insensitive) |
| Rimuove trattini | SÌ (tutti) | No (solo ` - `) | No (solo `-`) |
| Skip filter se exact | No | No | SÌ |

### 10.3 Contributo Automatico

Sistema GitHub Actions per aggiungere normalizzazioni:
1. Issue con template `[NORMALIZZA]`
2. Workflow rileva issue con label `normalizzazione`
3. Script Python genera PR con nuova voce
4. Commit: `feat(normalize): add "Titolo"`

---

## 11. Config Parsing System

### 11.1 Multi-Format Parsing (`parseConfigFromArgs`)

La configurazione può arrivare in **3 formati** diversi, provati in ordine:

1. **JSON diretto** — `JSON.parse(args)`
2. **URL-encoded** — `decodeURIComponent(args)` → JSON
3. **Base64** — `Buffer.from(base64, 'base64')` → JSON

Supporta anche estrazione JSON da stringa decodificata se contiene `{...}`.

### 11.2 Config Normalization (`normalizeConfig`)

Normalizza tutti i valori:
- **URL** → rimuove trailing slash
- **Booleani** → da stringa/numero/bool a booleano effettivo
- **Password** → preserva ESATTAMENTE (no trim!)
- **API Key** → solo trim

---

## 12. Provider Cache System

### 12.1 Cache Key Construction

```typescript
SHA-256({
  type, mfpUrl, mfpPswHash, useMediaFlow,
  tmdbKey, addonBase,
  animeunityEnabled, animesaturnEnabled, animeworldEnabled,
  animeunityDirect, animeunityDirectFhd, animeunityProxy
})
```

### 12.2 Memory Leak Prevention

**Problema:** I titoli degli stream contengono `sliced-string` views dell'HTML sorgente, che pinna ~2MB di HTML per entry in heap.

**Soluzione:** JSON roundtrip per materializzare le stringhe:
```typescript
JSON.parse(JSON.stringify(streams))  // Flattizza tutto
```

### 12.3 LRU-ish Eviction

- **Max entries:** 500 (configurabile con `PROVIDER_CACHE_MAX_ENTRIES`)
- **TTL:** 5 min (configurabile con `PROVIDER_CACHE_TTL_MS`)
- **Disabilitabile:** `PROVIDER_CACHE_DISABLE=1`
- **Eviction:** prima elimina expired, poi le più vecchie

---

## 13. Streaming Backend

### 13.1 Modalità di Streaming (VixSrc)

Il sistema VixSrc supporta **4 modalità** combinate tra loro:

| Checkbox | Flag Interno | Descrizione |
|----------|-------------|-------------|
| `vixDirect` | `vixLocal=true` | Direct (token IP-bound, locale) |
| `vixDirectFhd` | `vixDual=true` + synthetic | Synthetic FHD (server riscrive HLS) |
| `vixProxy` | — | MFP Proxy (tutto via proxy) |
| `vixProxyFhd` | `vixDual=true` + synthetic | Synthetic MFP (synthetic + proxy) |

**Default:** se nessuna checkbox selezionata → Synthetic MFP (default cross-IP)

### 13.2 Direct Mode

```
VixSrc Page → API Endpoint → Token/Expires → Master Playlist (M3U8)
```

- Nessun proxy intermedio
- Richiede IP compatibile con VixSrc
- Supporta MP4 e M3U8
- Estrae token, expires, h=1 (FHD flag) dalla pagina embed
- Rileva lingue audio dal manifest HLS
- Ordine parametri URL: `b=1?token=...&expires=...&h=1`

### 13.3 MediaFlow Proxy Mode

```
VixSrc Page → MediaFlow /extractor/video.m3u8 → Video Stream
```

- Proxy avanzato con autenticazione
- URL: `{mfpUrl}/extractor/video.m3u8?host=VixCloud&d={encodedUrl}&max_res=true`
- Password via `api_password` param

### 13.4 Synthetic FHD Mode

```
Master Playlist → /vixsynthetic.m3u8?src={masterUrl} → Mini Master (1080p ITA)
```

- Il server **riscrive la playlist HLS** selezionando solo:
  - Variante video con risoluzione massima
  - Traccia audio italiana
- Endpoint: `{addonBase}/vixsynthetic.m3u8?src={masterUrl}&lang=it&max=1&multi=1`
- Badge FHD aggiunto nel nome stream (🔓FHD / 🔒 FHD)

### 13.5 MFP Proxy Puro Mode

Quando l'utente seleziona SOLO `vixProxy`:
- **Nessuna chiamata server→vixsrc.to**
- Costruzione diretta URL proxy verso MFP
- Il client Stremio fa tutto il lavoro di fetch
- Rilevamento lingua audio disabilitato (default: ITA+ENG)

---

### 13.6 Matrice Scenari VixSrc

Il sistema genera varianti stream basandosi su 4 scenari:

| Scenario | vixLocal | vixDual | Stream Generati |
|----------|----------|---------|-----------------|
| **1** | ✅ | ❌ | Direct + Proxy (base) |
| **2** | ✅ | ✅ | Direct + Proxy + Synthetic FHD + Proxy Synthetic FHD |
| **3** | ❌ | ✅ | Synthetic FHD + Proxy Synthetic FHD |
| **4** | ❌ | ❌ | Proxy solo |

---

## 14. VixSrc Proxy Fallback System

### 14.1 Proxy Round-Robin

```typescript
PROXY     → primary proxy URL
PROXY_BACKUP → backup proxy URL
```

Alternanza round-robin tra i due proxy per distribuire il traffico.

### 14.2 `vixsrcFetch()` — Drop-in Replacement per fetch()

```
1. Se proxy mode attivo → tenta diretto (timeout 1.5s)
2. Se diretto OK → ritorna
3. Se diretto bloccato → retry via PROXY
4. Se PROXY fallisce → retry via PROXY_BACKUP
5. Se tutti falliscono → ritorna ultimo errore
```

### 14.3 Status Bloccati

```
0 (null), 401, 403, 429, 500-599
```

### 14.4 Proxy Implementation

- **SOCKS5** → `socks-proxy-agent` + `axios`
- **HTTP/S** → `undici.ProxyAgent`

---

## 15. VixSynthetic Endpoint (HLS Master Playlist Rewriter)

### 15.1 Endpoint

```
GET /vixsynthetic?src={url}&lang={it}&max={1}&multi={0|1}
GET /vixsynthetic.m3u8?src={url}&lang={it}&max={1}&multi={0|1}
```

### 15.2 Funzionalità

Riceve un URL di master playlist HLS e restituisce una **mini master** con:

1. **Seleziona variante video** con risoluzione massima
2. **Filtra traccia audio** per lingua (`lang=it` default)
3. **Supporta multi-lingua** (`multi=1` include tutte le tracce)
4. **Risolve URI relativi** rispetto all'upstream
5. **Gestisce redirect** (max 5, con validazione DNS per ciascuno)

### 15.3 HLS Parsing

```
1. Fetch master playlist (con redirect handling)
2. Parse #EXT-X-STREAM-INF → varianti (resolution, bandwidth)
3. Parse #EXT-X-MEDIA → renditions (AUDIO, SUBTITLES)
4. Seleziona migliore variante video (height → bandwidth)
5. Seleziona traccia audio corrispondente (GROUP-ID matching)
6. Ricostruisce master con sola variante selezionata
```

### 15.4 Redirect Handling

- Max 5 redirect
- Ogni redirect validato con DNS safety check
- DNS pinned agent per prevenire DNS rebinding
- Rewrite URI relativi dopo redirect

---

## 16. MediaFlow Proxy

### 16.1 Formattazione URL

```typescript
formatMediaFlowUrl(mp4Url, mfpUrl, mfpPassword)
  → {mfpUrl}/proxy/stream/{filename}?d={encodedUrl}&api_password={psw}
```

### 16.2 Configurazione

| Env Var | Descrizione |
|---------|-----------|
| `MFP_URL` | URL base MediaFlow |
| `MFP_PSW` / `MFP_PASSWORD` | Password API |
| `PROXY_BACKEND` / `MFP_BACKEND` | `mediaflow` o `mfp` |
| `useMediaFlow` (config) | Override per-request |

---

## 17. VixCloud / Streamtape Extraction

### 17.1 Host Supportati

```
mixdrop, dropload, streamtape, supervideo, doodstream,
deltabit, loadm, maxstream, streamhg, audinifer
```

### 17.2 Pipeline

```
1. Fetch embed page con headers realistici
2. Estrai iframe src
3. Fetch iframe page
4. Parsa script tags per token/auth
5. Costruisci URL stream finale
6. Supporto HLS (m3u8) con playlist parsing
```

### 17.3 Anti-Detection

- User-Agent realistici (Chrome 137)
- Headers `Referer`, `Origin`, `Accept-Language`
- Proxy rotation (socks/https)
- Timeout configurabile per request

---

## 18. Unificazione Stream

### 18.1 Format Titolo Multilinea

```
🎬 Titolo Anime
🗣 🇮🇹 [ITA]  ← o [SUB]
💾 1.5GB    ← opzionale
▶️ VixCloud  ← opzionale
🌐 Proxy (ON/OFF)
🤌 Anime Unity ⛩️ 🅵🅷🅳  ← opzionale
```

### 18.2 Binge Grouping

**Logica per provider:**

| Provider | Binge Group |
|----------|------------|
| AnimeUnity | `animeunity-std-ita` / `animeunity-std-sub` |
| AnimeSaturn | `animesaturn-std-ita` / `animesaturn-std-sub` |
| AnimeWorld | `animeworld-std-ita` / `animeworld-std-sub` |
| VixSrc | `vixsrc-direct` / `vixsrc-directFHD` / `vixsrc-proxy` / `vixsrc-proxyFHD` |

### 18.3 Ordinamento

1. **Primo:** Ordinamento alfabetico per titolo (`sortStreamsByPriority`)
2. **Secondo:** Priorità provider: AnimeUnity (1) > AnimeSaturn (2) > AnimeWorld (3)

---

## 19. Caching

### 19.1 Livelli di Cache

| Livello | Chiave | TTL | Scopo |
|---------|--------|-----|-------|
| **HTTP** | `{as}:{method}:{url}:{body}` | Configurabile | Cache fetch HTTP |
| **Mapping** | `{provider}:{id}:s={season}:ep={ep}:lang={lang}` | 2 min | Cache mapping API |
| **Inflight** | `http:{key}` | Finché request viva | Deduplication richieste |
| **Provider** | `{type}:{id}:{configHash}` | Sessione | Cache stream completi |
| **Domains** | — | 12 ore | Cache domini provider |
| **PlayLang** | `{slug}` | Sessione | Cache lingua play page |

### 19.2 Provider Cache Key

```typescript
SHA-256({
  type, mfpUrl, mfpPswHash, useMediaFlow,
  tmdbKey, addonBase,
  animeunityEnabled, animesaturnEnabled, animeworldEnabled,
  animeunityDirect, animeunityDirectFhd, animeunityProxy
})
```

---

## 20. AnimeGate (Rilevamento Anime)

### 20.1 Strategia

```
1. Haglund Mappings (MAL/Kitsu da TMDB ID)
   └─ Se trovato → isAnime = true
2. TMDB Fallback
   └─ Genres include "Animation" AND (JP country OR ja language)
   └─ Configurabile con ANIME_GATE_TMDB_FALLBACK
```

### 20.2 Funzioni

| Funzione | Scopo |
|----------|-------|
| `checkIsAnimeById(type, id)` | Verifica se ID è un anime |
| `applyUniversalAnimeTitleNormalization(title)` | Normalizza varianti titolo |
| `buildAnimeIdWarningStream(source)` | Stream warning se non trovato |

### 20.3 Env Vars

| Variabile | Default | Descrizione |
|-----------|---------|-------------|
| `ANIME_GATE_ENABLED` | `true` | Abilita tutto il sistema |
| `ANIME_GATE_TMDB_FALLBACK` | `true` | Usa fallback TMDB |
| `ANIME_GATE_PLACEHOLDER_ENABLED` | `true` | Mostra stream placeholder |

---

## 21. Title Resolver

### 21.1 File: `animeTitleResolver.ts`

**Responsabilità:** Risoluzione titoli inglesi da ID esterni.

### 21.2 Fonti Dati

```
1. Kitsu API → titolo inglese + MAL ID + TMDB ID
2. Jikan API (MAL) → titolo inglese
3. TMDB API → titolo + dettagli
4. Haglund API → mapping TMDB↔MAL↔Kitsu
5. Anime Mapping API → mapping provider-specific
```

### 21.3 Funzioni Principali

| Funzione | Input | Output |
|----------|-------|--------|
| `resolveAnimeTitle()` | ID + tipo | `AnimeResolvedTitle` |
| `resolveFromKitsu()` | kitsuId | titolo, MAL ID, TMDB ID, data |
| `resolveFromMal()` | malId | titolo inglese |
| `resolveFromImdb()` | imdbId | titolo, mapping, episodi |
| `resolveFromTmdb()` | tmdbId | titolo, mapping, episodi |

### 21.4 Episode Mode

Il resolver determina la modalità episodio:
- **Absolute** — episodi numerati in assoluto (es. One Piece)
- **Season-based** — episodi per stagione (standard)

---

## 22. Landing Page & UI

### 22.1 Template

**File:** `src/landingPage.ts`

Pagina HTML generata dinamicamente con:
- Form configurazione
- Toggle provider (AU/AS/AW)
- Input MFP URL/password
- Select proxy backend
- Info versione e link GitHub

### 22.2 Accessibile su

```
http://localhost:7000/
```

---

## 23. DNS Safety & Security

### 23.1 DNS Verifier

**File:** `addon.ts` (righe ~1199-1262)

Verifica che gli URL di stream puntino a domini sicuri prima di essere restituiti:

```typescript
verifyDnsSafety(url) → { safe: boolean, addresses: string[] }
```

### 23.2 Controlli

| Controllo | Descrizione |
|-----------|-------------|
| **Private IPv4** | Blocca 10.x, 192.168.x, 172.16.x |
| **Private IPv6** | Blocca fc00::, fe80::, ::1 |
| **Loopback** | Blocca 127.x, ::1 |
| **Link-local** | Blocca 169.254.x |
| **Allowed hosts** | Whitelist host consentiti |

### 23.3 Blocked Domains

Lista di domini bloccati definita in `anime-core/helpers.ts` (`BLOCKED_DOMAINS`).

---

## 24. Workflow GitHub Automations

### 24.1 Normalizzazione Automatica

| Workflow | Trigger | Scopo |
|----------|---------|-------|
| `auto-normalization.yml` | Issue aperta | PR per AnimeSaturn |
| `auto-normalization-animeunity.yml` | Issue aperta | PR per AnimeUnity |
| `auto-normalization-animeworld.yml` | Issue aperta | PR per AnimeWorld |
| `issue-release-bump.yml` | Release | Versionamento automatico |

### 24.2 Template Issue

| Template | Prefisso Issue |
|----------|---------------|
| `nuova_normalizzazione.yml` | `[NORMALIZZA]: ` |
| `nuova_normalizzazione_animeunity.yml` | `[NORMALIZZA AU]: ` |
| `nuova_normalizzazione_animeworld.yml` | `[NORMALIZZA AW]: ` |

### 24.3 Script Python

| Script | Scopo |
|--------|-------|
| `scripts/auto_normalize.py` | Genera PR AnimeSaturn |
| `scripts/auto_normalize_animeunity.py` | Genera PR AnimeUnity |
| `scripts/auto_normalize_animeworld.py` | Genera PR AnimeWorld |

---

## 25. Docker & Deployment

### 25.1 Dockerfile

```dockerfile
# Build stage
FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# Production stage
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/config ./config
COPY --from=builder /app/public ./public
EXPOSE 7000
CMD ["node", "dist/addon.js"]
```

### 25.2 Docker Compose

```yaml
services:
  hanx:
    build: .
    ports:
      - "7000:7000"
    environment:
      - PORT=7000
      - TMDB_API_KEY=xxx
      - MFP_URL=xxx
      - ANIMEUNITY_ENABLED=true
      # ...
```

### 25.3 Variabili Ambiente Chiave

| Variabile | Default | Descrizione |
|-----------|---------|-------------|
| `PORT` | `7000` | Porta server |
| `TMDB_API_KEY` | — | Chiave API TMDB |
| `MFP_URL` | — | URL MediaFlow Proxy |
| `MFP_PSW` | — | Password MediaFlow |
| `ANIMEUNITY_ENABLED` | `true` | Abilita AnimeUnity |
| `ANIMESATURN_ENABLED` | `true` | Abilita AnimeSaturn |
| `ANIMEWORLD_ENABLED` | `true` | Abilita AnimeWorld |
| `ADDON_BASE_URL` | — | Base URL addon |
| `DEBUG_LOG` | `false` | Debug logging |
| `PROXY_URL` | — | Proxy URL generico |
| `AU_PROXY` / `AS_PROXY` / `AW_PROXY` | — | Proxy per-provider |
| `AU_USER_AGENT` | — | User-Agent AnimeUnity |
| `ANIME_FETCH_TIMEOUT_MS` | `10000` | Timeout fetch anime |
| `PROVIDER_URLS_URL` | GitHub raw | URL remote provider config |

---

## 🧩 Riepilogo Dipendenze

### Runtime (28 pacchetti)

| Categoria | Pacchetti |
|-----------|-----------|
| **HTTP/Fetch** | `axios`, `got-scraping`, `undici`, `node-fetch` |
| **Proxy** | `https-proxy-agent`, `socks-proxy-agent` |
| **HTML Parsing** | `cheerio`, `jsdom` |
| **XML/HLS** | `xml2js`, `sax` |
| **Caching** | `@keyv/sqlite`, `cacheable` |
| **Web Framework** | `express` |
| **Logging** | `winston` |
| **Utilities** | `bytes`, `randomstring`, `slugify`, `mime-types`, `tough-cookie`, `async-mutex`, `unpacker` |
| **Stremio** | `stremio-addon-sdk` |

### Dev Dependencies

| Pacchetto | Scopo |
|-----------|-------|
| `typescript` | Compilation |
| `tsx` | TypeScript execution (dev) |
| `ts-node` | TypeScript execution |
| `@types/*` | Type definitions |

---

## 📐 Pattern Architetturali

### 1. Provider Plugin Architecture
Ogni provider è una classe indipendente che implementa la stessa interfaccia:
- `handleKitsuRequest(id)` → `{ streams }`
- `handleMalRequest(id)` → `{ streams }`
- `handleImdbRequest(id, season, episode, isMovie)` → `{ streams }`
- `handleTmdbRequest(id, season, episode, isMovie)` → `{ streams }`

### 2. Fan-out Parallel Pattern
Tutti i provider abilitati vengono eseguiti in parallelo con `Promise.all()`:
```typescript
const providerPromises: Promise<Stream[]>[] = [];
scheduleProviderRun('AnimeUnity', enabled, handler, ...);
scheduleProviderRun('AnimeSaturn', enabled, handler, ...);
scheduleProviderRun('AnimeWorld', enabled, handler, ...);
const allResults = await Promise.all(providerPromises);
```

### 3. Cache-Aside Pattern
Prima di ogni operazione costosa, si controlla la cache:
```typescript
const cached = _providerCacheGet(type, id, configHash);
if (cached) return { streams: cached };
```

### 4. Retry with Fallback Pattern
Se un provider non trova risultati:
1. Prova con titolo normalizzato
2. Prova con varianti apostrofi
3. Prova con ricerca per anno (Kitsu fallback)
4. Prova con ricerca loose (senza MAL ID)

### 5. Inflight Deduplication Pattern
Richieste HTTP duplicate per la stessa URL condividono la stessa Promise:
```typescript
const running = caches.inflight.get(inflightKey);
if (running) return running;  // Condividi la richiesta in corso
```

---

## 🔄 Diagramma Sequenza Completo

```
Stremio Client                HanX Addon                 Provider Sites        External APIs
     │                            │                           │                      │
     │── /stream/anime/tt12345 ──>│                           │                      │
     │                            │── [1] Parse ID (tt→IMDB) │                      │
     │                            │── [2] Check Provider Cache│                     │
     │                            │                          │                      │
     │                            │── [3] TMDB Find (IMDB→TMDB)                    │
     │                            │───────────────────────────────────────────────>│
     │                            │<────────────────────────────────────────────────│
     │                            │     TMDB ID + Title    │                      │
     │                            │                          │                      │
     │                            │── [4] Fan-out Providers (parallelo)             │
     │                            │                          │                      │
     │                            │──> AnimeUnity          │                      │
     │                            │──> AnimeSaturn         │                      │
     │                            │──> AnimeWorld          │                      │
     │                            │                          │                      │
     │                            │     │                    │                      │
     │                            │     │── [5] Search Title ──────────────────────>│
     │                            │     │                    │   AnimeUnity/Saturn/World
     │                            │     │<───────────────────│                      │
     │                            │     │   Results          │                      │
     │                            │     │                    │                      │
     │                            │     │── [6] Parse Pages ───────────────────────>│
     │                            │     │                    │   Embed pages
     │                            │     │<───────────────────│                      │
     │                            │     │   HTML             │                      │
     │                            │     │                    │                      │
     │                            │     │── [7] Extract Video ─────────────────────>│
     │                            │     │                    │   VixCloud/Mixdrop/etc
     │                            │     │<───────────────────│                      │
     │                            │     │   Stream URLs      │                      │
     │                            │                          │                      │
     │                            │── [8] Unify & Sort       │                      │
     │                            │── [9] Cache Result       │                      │
     │                            │                          │                      │
     │<── { streams: [...] } ────│                          │                      │
     │                            │                          │                      │

     │  ┌─────────────────────────────────────────────────┐ │
     │  │ Stream Format (per ogni stream):                │ │
     │  │  - title: multilinea con emoji                   │ │
     │  │  - url: video URL o proxy URL                    │ │
     │  │  - name: "🤌 Anime Unity ⛩️"                     │ │
     │  │  - behaviorHints.bingeGroup: "animeunity-std-ita"│ │
     │  └─────────────────────────────────────────────────┘ │
```

---

*Documento generato automaticamente dall'analisi completa del codicebase HanX v12.4.23.*
