# HanX — Architettura Runtime

> **Ambito:** comportamento del processo addon e dei percorsi effettivamente raggiunti dalle richieste runtime. I moduli presenti nel repository ma non collegati al flusso normale degli stream sono elencati separatamente.
>
> **Verificato il:** 2026-10-12
> **Versione package:** `1.0.0` (`package.json`)
> **ID addon:** `org.stremio.hanx`

---

## Indice

1. [Sintesi](#1-sintesi)
2. [Avvio e server HTTP](#2-avvio-e-server-http)
3. [Manifest e configurazione addon](#3-manifest-e-configurazione-addon)
4. [Richiesta stream e configurazione effettiva](#4-richiesta-stream-e-configurazione-effettiva)
5. [Provider e risoluzione dei titoli](#5-provider-e-risoluzione-dei-titoli)
6. [Composizione, ordinamento e cache degli stream](#6-composizione-ordinamento-e-cache-degli-stream)
7. [Infrastruttura condivisa usata dai provider](#7-infrastruttura-condivisa-usata-dai-provider)
8. [Endpoint Express aggiuntivi](#8-endpoint-express-aggiuntivi)
9. [Mappa dei moduli runtime](#9-mappa-dei-moduli-runtime)
10. [Build e deployment](#10-build-e-deployment)
11. [Variabili d’ambiente principali](#11-variabili-dambiente-principali)
12. [Codice presente ma non integrato nel flusso stream](#12-codice-presente-ma-non-integrato-nel-flusso-stream)

---

## 1. Sintesi

HanX è un addon Stremio dedicato alla ricerca di stream anime sui provider AnimeUnity, AnimeSaturn e AnimeWorld. Il server è implementato in `src/addon.ts` con Express e `stremio-addon-sdk`.

Il percorso runtime principale è:

```text
Client Stremio
    │
    ├── manifest /stream/... ──> Express ──> router Stremio SDK
    │                                      │
    │                                      ▼
    │                                stream handler
    │                                      │
    │             parse ID + config + cache │
    │                                      ▼
    │                       AnimeUnity ─┐
    │                       AnimeSaturn ├─ fan-out parallelo
    │                       AnimeWorld ─┘
    │                                      │
    │                     mapping o ricerca titolo
    │                                      │
    │                        scraping pagine/episodi
    │                                      │
    │                     raccolta e formattazione stream
    │                                      │
    └──────────────────────── { streams: [...] }
```

Il manifest dichiara i tipi `movie`, `series` e `anime`, ma non dichiara cataloghi (`catalogs: []`). Il meta handler attualmente restituisce `{ meta: null }`. La funzione principale dell’addon è quindi l’handler `stream`.

---

## 2. Avvio e server HTTP

### Entry point

`package.json` definisce:

| Comando | Comportamento |
|---|---|
| `pnpm run build` | Compila `src/` con TypeScript e copia le configurazioni in `dist/config/`. |
| `pnpm start` | Avvia `node dist/addon.js`. |
| `pnpm dev` | Avvia `src/addon.ts` tramite `tsx`. |

Il progetto è ESM (`"type": "module"`); `src/addon.ts` inizializza il builder e il router globali, crea l’app Express e ascolta su `0.0.0.0`, usando `PORT` oppure la porta `7000`.

### Routing

Le route Express aggiuntive sono registrate in `src/addon.ts`:

- `GET /vixsynthetic` e `GET /vixsynthetic.m3u8`: riscrittura HLS descritta nella sezione [Endpoint Express aggiuntivi](#8-endpoint-express-aggiuntivi).
- `/public/*`: static file server, configurato per leggere `../public` rispetto alla directory del modulo compilato.
- Le altre richieste passano attraverso un middleware che analizza l’eventuale configurazione nel segmento URL e le inoltra al router generato da `getRouter()`.
- La route `GET /` per la landing page è dichiarata **dopo** il middleware del router SDK; nello smoke test locale e nel container il router lascia proseguire la richiesta e la landing risponde HTTP 200.

Il middleware contiene anche una trasformazione della query catalog AnimeWorld, ma il manifest corrente non dichiara cataloghi: non è un catalogo registrato dall’addon.

---

## 3. Manifest e configurazione addon

### Manifest

Il manifest base definito in `src/addon.ts` dichiara:

```json
{
  "id": "org.stremio.hanx",
  "version": "12.4.23",
  "name": "HanX",
  "types": ["movie", "series", "anime"],
  "idPrefixes": ["tt", "kitsu", "mal", "tmdb"],
  "catalogs": [],
  "resources": ["stream", "meta"],
  "behaviorHints": { "configurable": true }
}
```

Il manifest offre questi campi di configurazione:

| Chiave | Ruolo runtime |
|---|---|
| `tmdbApiKey` | Chiave TMDB personale. |
| `mediaFlowProxyUrl`, `mediaFlowProxyPassword` | URL e password del proxy, se usati. |
| `useMediaFlow` | Flag interpretato dall’handler e passato nella configurazione provider. I provider correnti non lo leggono per selezionare il formato dell’URL stream, quindi il suo effetto sul backend non è dimostrato dal percorso runtime. |
| `animeunityEnabled`, `animesaturnEnabled`, `animeworldEnabled` | Abilitazione dei provider. |
| `animeunityDirect`, `animeunityDirectFhd`, `animeunityProxy` | Flag specifici per gli stream AnimeUnity. |
| `personalTmdbKey`, `mediaflowMaster` | Toggle helper UI; non sono opzioni lette dalla logica stream per selezionare un provider o backend. |

Sono quindi **12 voci** nello schema del manifest, di cui le ultime due sono helper UI.

### Override del manifest

`loadCustomConfig()` cerca `addon-config.json` nella directory padre di `src/` o `dist/` e sovrascrive nome, ID, descrizione, versione e immagini del manifest base.

Nel checkout locale `addon-config.json` è nella root e imposta `org.stremio.hanx`, nome `HanX` e versione `1.0.0`. L’immagine Docker corrente non copia questo file nella root `/app`: nel container il loader ripiega quindi sul manifest base, versione `12.4.23`.

---

## 4. Richiesta stream e configurazione effettiva

### Formati ID gestiti

L’handler normalizza anche i tipi legacy `film` → `movie` e `serie` → `series`. Per gli ID riconosciuti instrada:

| Forma ID | Interpretazione runtime |
|---|---|
| `kitsu:ID` | Kitsu senza episodio esplicito. |
| `kitsu:ID:EP` | Episodio Kitsu. |
| `kitsu:ID:STAGIONE:EP` | Stagione ed episodio Kitsu. |
| `mal:ID` | MAL senza episodio esplicito. |
| `mal:ID:EP` | Episodio MAL. |
| `mal:ID:STAGIONE:EP` | Stagione ed episodio MAL. |
| `ttID` / `ttID:EP` / `ttID:STAGIONE:EP` | IMDb; stagione ed episodio sono ricavati dai segmenti dopo `:`. Un ID senza segmenti aggiuntivi è trattato come film. |
| `tmdb:ID` / `tmdb:ID:EP` / `tmdb:ID:STAGIONE:EP` | TMDB; un ID senza segmenti aggiuntivi è trattato come film. |

I provider restituiscono una lista vuota per ID non riconosciuti o quando nessun provider è abilitato.

### Parsing e precedenza delle impostazioni

La configurazione può arrivare come oggetto SDK o come stringa JSON, JSON URL-encoded o Base64. Il middleware tenta di decodificare il segmento configurazione della richiesta; per Base64 valido riscrive il segmento in JSON URL-encoded prima dell’inoltro al router SDK. `normalizeConfig()` converte i booleani riconosciuti, elimina gli slash finali dall’URL MFP, fa trim della chiave TMDB e preserva esattamente la password.

La precedenza **varia in base al campo**:

| Campo | Risoluzione effettiva |
|---|---|
| URL MFP | Configurazione richiesta, poi `MFP_URL`. |
| Password MFP | `mediaFlowProxyPassword`, poi `MFP_PSW`, poi `MFP_PASSWORD`. Una stringa vuota esplicita prevale sui fallback. |
| Flag backend proxy | L’handler calcola `useMediaFlow` da un booleano esplicito; altrimenti da `PROXY_BACKEND` o `MFP_BACKEND` uguale a `mediaflow`/`mfp`; altrimenti `false`. Il valore entra nella firma cache ed è passato ai provider, ma questi non lo leggono nel codice corrente per cambiare la URL stream. |
| Chiave TMDB | Configurazione richiesta, poi `TMDB_API_KEY`, poi il fallback interno passato ai provider. |
| Abilitazione provider | Variabile d’ambiente corrispondente, se presente, prevale sulla richiesta. Il valore ambiente abilita solo se è esattamente `true` (case-insensitive). In assenza di flag ambiente, la richiesta abilita i provider con flag `true`. Se la richiesta non contiene nessuno dei tre flag provider, il percorso API li considera tutti abilitati. |

Il percorso «API diretta» è rilevato dall’assenza dei campi `animeunityEnabled`, `animesaturnEnabled` e `animeworldEnabled`, non dalla totale assenza di qualsiasi configurazione.

### Passi dell’handler

1. Normalizza il tipo e la configurazione della richiesta.
2. Risolve le impostazioni proxy e l’abilitazione dei tre provider.
3. Per `tt…` e `tmdb:…`, interpreta film/episodio/stagione.
4. Per ID `kitsu:`, `mal:`, `tt…` e `tmdb:`, costruisce la firma della configurazione e verifica la cache stream.
5. Se manca una cache hit, avvia in parallelo ogni provider abilitato con timeout di 30 secondi per provider.
6. Unisce, formatta e ordina gli stream; salva in cache solo risposte non vuote.
7. In caso di errore generale dell’handler restituisce `{ streams: [] }`.

Il timeout usa `Promise.race`: il timeout chiude l’attesa dell’handler ma non è un meccanismo di cancellazione della richiesta HTTP in corso.

---

## 5. Provider e risoluzione dei titoli

I provider sono implementati in moduli separati. AnimeUnity è importato direttamente da `addon.ts`; AnimeSaturn e AnimeWorld vengono caricati dinamicamente quando si esegue il relativo task.

| Provider | Percorso runtime |
|---|---|
| **AnimeUnity** (`src/providers/animeunity-provider.ts`) | Gestisce i quattro formati ID. Usa Mapping API quando applicabile e, in caso di miss, ricerca per titolo e parsing delle pagine anime/episodio. Per IMDb/TMDB applica AnimeGate. |
| **AnimeSaturn** (`src/providers/animesaturn-provider.ts`) | Gestisce i quattro formati ID. Usa Mapping API e fallback per titolo quando applicabile; per AnimeSaturn la lookup Mapping API richiede la lingua `it`. Per IMDb/TMDB applica AnimeGate. |
| **AnimeWorld** (`src/providers/animeworld-provider.ts`) | Gestisce i quattro formati ID. Usa Mapping API e fallback per titolo quando applicabile; analizza le pagine AnimeWorld e costruisce stream dai link media trovati. Per IMDb/TMDB applica AnimeGate. |

### Produzione degli stream e proxy

- **AnimeUnity:** legge i dati anime/episodi dalla pagina e seleziona l’episodio richiesto. L’estrazione HLS dall’embed è disabilitata nel provider corrente; resta il fallback MP4 condizionato e la costruzione di un URL proxy MFP per l’embed. Le opzioni `animeunityDirect`, `animeunityDirectFhd` e `animeunityProxy` controllano quali stream vengono restituiti; il flag `DirectFhd` non è sufficiente a dimostrare che venga costruita una playlist sintetica.
- **AnimeWorld:** estrae link MP4 dalla pagina di riproduzione; senza URL MFP restituisce il link con gli header/referer nel `behaviorHints`, mentre con URL MFP costruisce un URL `/proxy/stream`.
- **AnimeSaturn:** estrae e normalizza gli stream dalle pagine anime/episodio e dai player collegati. Nel codice provider corrente non risulta una lettura delle opzioni MFP o `useMediaFlow`.

La selezione del backend proxy non è quindi un comportamento uniforme tra i tre provider.

### Differenze nel lookup

- **Kitsu:** i provider provano il mapping Kitsu e possono usare i metadati Kitsu per un titolo rapido; se il mapping non produce stream, passano alla risoluzione del titolo e alla ricerca sul sito.
- **MAL:** i provider ricavano il titolo da Tenrai (`GET /v1/anime/{id}`) e poi cercano sui siti; il percorso MAL non usa la Mapping API. Tenrai sostituisce l’API pubblica Jikan, dismessa il 1º ottobre 2026 ([annuncio maintainer](https://github.com/jikan-me/jikan-rest/issues/613)). La richiesta metadata è condivisa fra i provider e persistita in SQLite con ETag.
- **IMDb/TMDB:** AnimeGate precede la ricerca in ogni provider. Se il gate consente la richiesta, viene tentato il mapping specifico del provider; in caso di miss segue la risoluzione del titolo e la ricerca testuale.
- Il mapping IMDb può avere un secondo tentativo con l’ID TMDB quando la risposta non contiene percorsi specifici del provider e l’ID TMDB è disponibile.

La Mapping API è condivisa in `src/providers/anime-core/mapping-api.ts`; i provider estraggono dal payload i propri percorsi. Il resolver di mapping genera richieste del tipo `/{provider}/{id}?ep=…`, aggiunge `s=…` se presente e può aggiungere `lang=it`.

### AnimeGate

`checkIsAnimeById()` è chiamato dai tre provider per ID IMDb e TMDB, non per Kitsu o MAL. Se `ANIME_GATE_ENABLED` è diverso da `false`, il gate:

1. risolve IMDb→TMDB quando necessario;
2. accetta un mapping MAL/Kitsu trovato tramite Haglund;
3. altrimenti, se `ANIME_GATE_TMDB_FALLBACK` non è `false`, verifica su TMDB animazione e origine/lingua giapponese;
4. se non è anime, il provider restituisce zero stream.

Senza chiave TMDB il gate è permissivo. L’helper `buildAnimeIdWarningStream()` esiste, ma non è invocato dagli handler correnti; non viene restituito uno stream generico come fallback per un ID non-anime.

---

## 6. Composizione, ordinamento e cache degli stream

### Formattazione e ordinamento

`addon.ts` applica la formattazione nel proprio `unifyStreams()` (non tramite `buildUnifiedStreamName()`): titolo su più righe, etichetta provider, indicazione ITA/SUB, rilevamento del proxy e `behaviorHints.bingeGroup` per i provider.

L’ordinamento è eseguito in due passaggi: prima alfabetico per titolo, poi per priorità provider **AnimeUnity → AnimeSaturn → AnimeWorld**. Poiché l’ordinamento JavaScript è stabile, all’interno dello stesso provider viene mantenuto l’ordine alfabetico del primo passaggio.

### Cache completa della risposta provider

La cache in `src/addon.ts` è una `Map` in memoria, condivisa dal processo:

- chiave: tipo, ID e digest SHA-256 della configurazione effettiva;
- TTL predefinito: 5 minuti (`PROVIDER_CACHE_TTL_MS`);
- limite predefinito: 500 entry (`PROVIDER_CACHE_MAX_ENTRIES`);
- disattivazione: `PROVIDER_CACHE_DISABLE=1` (sono riconosciuti anche `true`, `on`, `yes`);
- risposte vuote non memorizzate;
- al superamento del limite elimina prima le entry scadute e poi quelle più vecchie;
- i dati vengono serializzati/deserializzati per materializzare le stringhe degli stream.

Le cache ausiliarie dei provider sono anch’esse in memoria e distinte per modulo/provider. Non esiste una cache persistente condivisa dal processo per gli stream restituiti.

### Cache persistente metadati MAL (Tenrai)

`src/providers/anime-core/tenrai-metadata.ts` usa SQLite (`node:sqlite`) per conservare i titoli MAL anche dopo il riavvio:

- una riga per MAL ID; i titoli positivi non vengono espulsi automaticamente;
- rispetta `Cache-Control` (default Tenrai: `max-age=3600`) e salva l’ETag;
- alla scadenza fa una richiesta condizionale `If-None-Match`: `304` rinnova la validazione senza riscaricare il payload, `200` sostituisce i dati;
- in caso di timeout/errore usa il dato stale se disponibile e applica backoff; `404` è memorizzato con TTL negativo;
- deduplica le chiamate in-flight tra AnimeUnity, AnimeSaturn e AnimeWorld;
- limiter persistente in SQLite: default prudenziale 3 RPS / 100 RPM, entro i limiti pubblici documentati da Tenrai. `Retry-After` viene rispettato;
- DB locale default `./data/tenrai-metadata.sqlite`; in Docker il volume `hanx-data` conserva `/app/data`.

Le riconvalide consumano comunque richieste API, ma non trasferiscono il corpo quando il contenuto è invariato. I dati rimangono in archivio finché non vengono invalidati da Tenrai (`404`), mentre gli errori temporanei non cancellano l’ultima copia valida.

---

## 7. Infrastruttura condivisa usata dai provider

`src/providers/anime-core/` fornisce funzioni realmente importate dai provider:

- `cache.ts`: helper per mappe TTL con scadenza e creazione delle mappe HTTP, mapping e in-flight per provider;
- `fetch-resource.ts`: fetch con timeout configurabile, cache HTTP opzionale e deduplicazione in-flight tramite tali mappe;
- `mapping-api.ts`: parsing ID/episodio, lookup API, cache Mapping di 2 minuti ed estrazione dei percorsi provider;
- `tenrai-metadata.ts`: store SQLite MAL persistente con ETag, rate limit, backoff e single-flight condiviso;
- `provider-urls.ts`: risoluzione dinamica di URL provider e Mapping API;
- `helpers.ts`: normalizzazione episodio/titolo/URL, selezione episodi, estrazione link e limitazione della concorrenza.

`fetchResource()` è il livello HTTP comune per le chiamate che lo usano; i provider contengono anche fetch diretti e logica HTTP specifica, quindi non tutte le richieste esterne transitano da questo wrapper.

### Risoluzione di URL e domini

Per provider riconosciuti, `getProviderUrl()` cerca nell’ordine:

1. `config/domains.json` tramite `getDomain()`;
2. dati JSON locali/remoti gestiti da `provider_urls.ts`;
3. variabili d’ambiente specificate dal chiamante.

Il file JSON locale viene ricontrollato in base a mtime (intervallo predefinito 1,5 secondi). Il refresh remoto è asincrono, predefinito ogni 10 secondi, e aggiorna la stessa mappa usata per i valori JSON. `domains.json` ha invece una cache in memoria di 12 ore. I valori file attuali sono in `config/domains.json` e `config/provider_urls.json`.

---

## 8. Endpoint Express aggiuntivi

### `/vixsynthetic` e `/vixsynthetic.m3u8`

L’endpoint in `src/addon.ts` accetta `src`, `lang` e le opzioni multi-lingua. Il codice:

- limita destinazioni e protocollo tramite whitelist HTTPS;
- risolve e controlla gli indirizzi DNS iniziali e quelli dei redirect;
- segue manualmente al massimo cinque redirect;
- scarica una playlist, risolve gli URI relativi e, per un master HLS, seleziona la variante con risoluzione/banda più alta;
- seleziona la traccia audio richiesta (default `it`) oppure include le rendition pertinenti in modalità multi.

Questo endpoint è registrato nel server Express, ma il flusso dei provider attivi non è stato trovato a generare URL verso di esso. Non va quindi descritto come parte della pipeline automatica degli stream. Inoltre, benché il codice costruisca un `https.Agent` con gli IP verificati, l’oggetto `currentAgent` non viene passato alla chiamata `globalThis.fetch`: il codice effettua i controlli DNS, ma non dimostra il DNS pinning descritto nei commenti.

### Landing page e asset

`GET /` genera HTML tramite `src/landingPage.ts`; il contenuto include il modulo web di configurazione. `/public/*` è registrato con `express.static()`. La posizione filesystem configurata per gli asset è relativa alla root del progetto quando si avvia il build locale; per la differenza nel container vedere [Build e deployment](#10-build-e-deployment).

---

## 9. Mappa dei moduli runtime

```text
src/
├── addon.ts                         Express, manifest, SDK, handler e orchestrazione
├── landingPage.ts                   HTML della landing page
├── providers/
│   ├── animeunity-provider.ts       Provider AnimeUnity
│   ├── animesaturn-provider.ts      Provider AnimeSaturn
│   ├── animeworld-provider.ts       Provider AnimeWorld
│   ├── kitsu.ts                    Parsing ID e helper Kitsu usato dai provider
│   └── anime-core/                 Cache, fetch, mapping, Tenrai/SQLite e helper condivisi
├── utils/
│   ├── animeGate.ts                Gate IMDb/TMDB e normalizzazione titolo condivisa
│   ├── domains.ts                  Lettura/cache di config/domains.json
│   ├── mediaflow.ts                Formattazione URL MediaFlow usata da AnimeUnity
│   ├── tmdbResolver.ts             Risoluzione IMDb→TMDB usata dai percorsi attivi
│   └── unifiedNames.ts             Etichette provider; la composizione principale è inline in addon.ts
└── config/
    └── imdbToTmdb.json             Dati statici usati dal resolver TMDB

config/
├── domains.json
└── provider_urls.json

addon-config.json                   Override manifest nella root del repository
```

---

## 10. Build e deployment

### Build locale

`pnpm run build` esegue `tsc` e `scripts/build-copy.js`. Lo script copia `config/` e i JSON di `src/config/` in `dist/config/`; non copia `addon-config.json` né `public/`. In un normale checkout questi ultimi restano nella root e sono raggiunti tramite i percorsi relativi definiti dal codice.

### Docker

Il `Dockerfile` corrente:

- usa `node:26-alpine` sia per build sia per runner;
- compila l’addon e nello stage finale copia in `/app` `dist/`, `node_modules/`, `addon-config.json`, `config/` e `public/`;
- crea `/app/data` accessibile solo all’utente non-root; Compose lo monta sul volume persistente `hanx-data`;
- carica le variabili runtime da `.env` via `env_file`; `.env` resta escluso dal contesto immagine e dal versionamento; `.env.example` è il template;
- espone la porta 7000 e avvia `node dist/addon.js` come utente non-root.

**Verifica effettiva del container dopo la correzione del Dockerfile:**

- `addon-config.json` è presente in `/app`; `GET /manifest.json` restituisce HTTP 200 con ID `org.stremio.hanx`, nome `HanX` e versione `1.0.0`.
- `/app/public/` contiene gli asset attesi: `GET /public/icon.png` e `/public/background.png` restituiscono entrambi HTTP 200 (`image/png`).
- `domains.json` e `provider_urls.json` sono presenti nel percorso runtime `/app/config/`. Una verifica eseguita dal container ha letto `animeunity.so` dai domini e `https://anime.stremio-italia.eu` come Mapping API.
- Il container è rimasto in stato `running` e l’health check Docker ha raggiunto `healthy`. `GET /` ha restituito HTTP 200 HTML; `/vixsynthetic` senza parametro `src` ha restituito HTTP 400, come previsto.
- La build dell’immagine è riuscita usando Docker Desktop 4.95.0 / Engine 29.8.2, target `linux/amd64`. Il container usa `undici` `8.11.2`, corrispondente al lockfile e compatibile con la dichiarazione `^8.11.2` in `package.json`; il pin Docker ad `6.19.8` è stato rimosso.
- Verifica migrazione: `GET /stream/anime/mal:1.json` ha restituito HTTP 200 con 2 stream AnimeWorld. Il DB del container ha una sola riga per MAL ID `1` e un solo evento Tenrai nonostante il fan-out a tre provider; l’ETag è stato persistito. Il volume di prova e la cache ETag sono stati inoltre testati con risposte `304` e aggiornamento `200`.
- Dopo aver rimosso e ricreato il container usando lo stesso volume, `mal:1` ha restituito ancora 2 stream HTTP 200 senza una seconda richiesta Tenrai: riga SQLite, ETag e limiter sono sopravvissuti al riavvio.
- `pnpm test`: 6 test superati per deduplicazione, persistenza, ETag, stale-on-error, `Retry-After` concorrente, cache negativa e budget richieste persistente.

Sono state provate ricerche reali con `kitsu:1` e `mal:1` (Cowboy Bebop). La richiesta Kitsu ha restituito 4 stream HTTPS tramite Mapping API; quella MAL, dopo la migrazione Tenrai, ha restituito 2 stream AnimeWorld. Non è stata verificata la riproduzione dei media. Durante il test MAL AnimeUnity ha ricevuto HTTP 405 e AnimeSaturn HTTP 404 dal percorso di ricerca, ma il provider AnimeWorld ha prodotto stream.

---

## 11. Variabili d’ambiente principali

Le variabili lette dai percorsi runtime documentati includono:

| Variabile | Uso |
|---|---|
| `PORT` | Porta HTTP; default `7000`. |
| `TMDB_API_KEY` | Chiave TMDB di fallback quando non fornita nella configurazione addon. |
| `MFP_URL`, `MFP_PSW`, `MFP_PASSWORD` | URL e credenziali proxy di fallback. |
| `PROXY_BACKEND`, `MFP_BACKEND` | Letti dall’handler per calcolare `useMediaFlow`; l’effetto sulla URL stream non è dimostrato perché i provider non leggono il flag. |
| `ANIMEUNITY_ENABLED`, `ANIMESATURN_ENABLED`, `ANIMEWORLD_ENABLED` | Override ambiente dell’abilitazione provider. |
| `ANIME_GATE_ENABLED`, `ANIME_GATE_TMDB_FALLBACK` | Abilitazione e fallback TMDB del gate per IMDb/TMDB. |
| `ADDON_BASE_URL` | Base URL addon passata al provider AnimeUnity. |
| `PROVIDER_CACHE_TTL_MS`, `PROVIDER_CACHE_MAX_ENTRIES`, `PROVIDER_CACHE_DISABLE` | Parametri della cache stream di `addon.ts`. |
| `ANIME_FETCH_TIMEOUT_MS` | Timeout predefinito del fetch condiviso dai provider. |
| `ANIMEUNITY_FETCH_TIMEOUT_MS`, `ANIMESATURN_FETCH_TIMEOUT_MS`, `ANIMEWORLD_FETCH_TIMEOUT_MS` | Timeout specifici definiti nei provider. |
| `AU_PROXY`, `AS_PROXY`, `AW_PROXY`, `PROXY` | Proxy HTTP dei fetch provider, dove usato dal relativo percorso. |
| `PROVIDER_URLS_FILE`, `PROVIDER_URLS_URL`, `PROVIDER_URLS_RELOAD_MS`, `PROVIDER_URLS_REMOTE_RELOAD_MS` | Sorgenti e intervalli per gli URL provider. |
| `TENRAI_API_BASE_URL`, `TENRAI_CACHE_DB_PATH` | Endpoint metadata e percorso del DB SQLite persistente. |
| `TENRAI_REQUEST_TIMEOUT_MS`, `TENRAI_CACHE_TTL_MS`, `TENRAI_NEGATIVE_CACHE_TTL_MS`, `TENRAI_STALE_IF_ERROR` | Timeout, freshness cap, cache ID mancanti e fallback stale. La validità effettiva non supera il `max-age` della risposta Tenrai. |
| `TENRAI_MAX_REQUESTS_PER_SECOND`, `TENRAI_MAX_REQUESTS_PER_MINUTE`, `TENRAI_MAX_PENDING_REQUESTS`, `TENRAI_MAX_QUEUE_WAIT_MS` | Throttling persistente e limiti della coda metadata; di default 3 RPS / 100 RPM. |
| `TENRAI_FAILURE_BACKOFF_MS`, `TENRAI_MAX_BACKOFF_MS`, `TENRAI_SERVER_KEY` | Backoff su errori; chiave server opzionale, inviata solo all’host ufficiale Tenrai. |
| `.env` / `.env.example` | Configurazione locale e template versionato dei parametri Tenrai; `.env` è ignorato da Git e Docker build. |
| `DEBUG_LOG` | Abilita i log diagnostici condizionali dell’handler/middleware. |

La lista non include variabili usate solo da script di manutenzione o componenti fuori dal flusso runtime degli stream.

---

## 12. Codice presente ma non integrato nel flusso stream

I seguenti moduli esistono nel repository, ma non risultano componenti invocati dal normale fan-out dei provider:

- `src/extractor.ts`: contiene codice di estrazione VixSrc/HLS, ma non è importato dai provider attivi né chiamato da `addon.ts`.
- `src/utils/animeTitleResolver.ts`: esporta un resolver, ma i provider usano funzioni di risoluzione locali e non importano questo modulo.
- `src/providers/flaresolverr.ts`: espone `fetchPage`; `addon.ts` lo importa, ma non ne usa il simbolo nel codice dell’handler. Non è il fetcher del percorso provider corrente.
- `buildAnimeIdWarningStream()` in `src/utils/animeGate.ts`: helper non richiamato dagli handler.
- `buildUnifiedStreamName()` in `src/utils/unifiedNames.ts`: helper non usato dalla composizione inline degli stream in `addon.ts`.

Questi elementi non sono rappresentati come stadi operativi nel diagramma del flusso stream. La loro eventuale integrazione futura richiede una verifica separata.

---

*Documento basato sul percorso runtime nel sorgente e sulla configurazione di build/deploy presenti nel repository alla data di verifica.*
