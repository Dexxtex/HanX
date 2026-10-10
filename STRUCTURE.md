# HanX — Struttura del Progetto

Addon Stremio per anime (AnimeUnity, AnimeSaturn, AnimeWorld).

## Root

```
HanX/
├── .dockerignore          # Esclusioni Docker
├── .env                   # Variabili d'ambiente
├── .gitignore             # Esclusioni Git
├── addon-config.json      # Configurazione addon
├── docker-compose.yml     # Compose per Docker
├── Dockerfile             # Immagine container
├── package.json           # Dipendenze (pnpm)
├── pnpm-lock.yaml         # Lockfile pnpm
├── tsconfig.json          # Configurazione TypeScript
├── README.md              # Documentazione principale
├── ISSUES.md              # Tracker problemi noti
├── MEMORY/                # Documentazione interna e storico
├── config/                # Configurazione esterna (domini, URL provider)
├── public/                # Asset pubblici (icone, immagini)
├── scripts/               # Script di normalizzazione e manutenzione
├── src/                   # Sorgente TypeScript
├── dist/                  # Output compilato (tsc)
├── server.log             # Log runtime
├── test-provider.ps1      # Script test provider (PowerShell)
└── test-provider-mal.ps1  # Script test provider con MAL (PowerShell)
```

## src/ — Sorgente principale

```
src/
├── addon.ts               # Entry point: express, route /meta, /stream, /vixsynthetic
├── addon.ts.backup        # Backup prima modifiche SSRF
├── extractor.ts           # Logica estrazione URL dai provider
├── landingPage.ts         # Pagina di configurazione/landing
├── stremio-addon-sdk.d.ts # Type declaration SDK Stremio
├── config/
│   └── imdbToTmdb.json    # Mappatura IMDB → TMDB
├── providers/             # Logica per ogni provider anime
│   ├── anime-core/        # Core condiviso per tutti i provider
│   │   ├── index.ts       # Esportazioni core
│   │   ├── cache.ts       # Gestione cache
│   │   ├── fetch-resource.ts  # HTTP con retry/timeout
│   │   ├── helpers.ts     # Utility comuni
│   │   ├── mapping-api.ts     # API di mappatura titoli
│   │   └── provider-urls.ts # URL base provider
│   ├── animeunity-provider.ts   # Provider AnimeUnity
│   ├── animesaturn-provider.ts  # Provider AnimeSaturn
│   ├── animeworld-provider.ts   # Provider AnimeWorld
│   ├── flaresolverr.ts          # Integrazione FlareSolverr
│   └── kitsu.ts                 # API Kitsu (metadata)
├── public/                # Asset web (landing page, icone)
│   ├── backround.png
│   ├── icon.png
│   └── landing.html
├── types/
│   ├── animeunity.ts      # Type per AnimeUnity
│   └── sax.d.ts           # Type per SAX parser XML
└── utils/                 # Utility trasversali
    ├── animeGate.ts               # Filtro/validazione anime
    ├── animeTitleResolver.ts      # Risolutore titoli anime
    ├── config.ts                  # Load/config parsing
    ├── domains.ts                 # Gestione domini whitelist
    ├── mediaflow.ts               # Proxy MediaFlow/MFP
    ├── packed.ts                  # Utility packing/unpacking
    ├── tmdbResolver.ts            # Risolutore TMDB
    └── unifiedNames.ts            # Normalizzazione nomi unificati
```

## config/ — Configurazione esterna

```
config/
├── domains.json             # Whitelist domini consentiti
└── provider_urls.json       # URL base dei provider
```

## scripts/ — Manutenzione

```
scripts/
├── auto_normalize.py                # Normalizzazione titoli generica
├── auto_normalize_animeunity.py     # Normalizzazione AnimeUnity
├── auto_normalize_animeworld.py     # Normalizzazione AnimeWorld
├── check_domains.js                 # Validazione domini (Node)
└── update_domains.py                # Aggiornamento domini
```

## .github/ — Automazione

```
.github/
├── ISSUE_TEMPLATE/
│   ├── config.yml
│   ├── nuova_normalizzazione.yml
│   ├── nuova_normalizzazione_animeunity.yml
│   └── nuova_normalizzazione_animeworld.yml
├── PULL_REQUEST_TEMPLATE.md
└── workflows/
    ├── auto-normalization.yml
    ├── auto-normalization-animeunity.yml
    ├── auto-normalization-animeworld.yml
    ├── dkhub.yml
    ├── dockerhub.yml
    ├── issue-release-bump.yml
    ├── release-please.yaml
    └── update-domains.yml
```

## Dipendenze chiave (package.json)

| Categoria | Pacchetti |
|-----------|-----------|
| **HTTP/ scraping** | `node-fetch`, `got-scraping`, `axios`, `cheerio`, `jsdom` |
| **Proxy/agent** | `https-proxy-agent`, `socks-proxy-agent`, `tough-cookie` |
| **Storage** | `@keyv/sqlite`, `cacheable` |
| **Parsing** | `sax`, `xml2js`, `unpacker` |
| **Utility** | `slugify`, `bytes`, `randomstring`, `async-mutex` |
| **Logging** | `winston` |
| **Runtime** | `express`, `stremio-addon-sdk`, `undici` |
| **Dev** | `typescript`, `ts-node`, `shx`, `@types/*` |

## Build

```bash
pnpm build     # tsc + copia config/dist
pnpm start     # node dist/addon.js
pnpm dev       # ts-node src/addon.ts
```

Output compilato: `dist/addon.js` (entry point), `dist/providers/`, `dist/utils/`, `dist/config/`.
