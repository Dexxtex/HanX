# HanX

**Addon Stremio/NUVIO dedicato agli anime** — aggrega stream da AnimeUnity, AnimeSaturn e AnimeWorld in un'unica interfaccia.

![Version](https://img.shields.io/badge/version-12.4.23-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20-green)
![Docker](https://img.shields.io/badge/docker-ready-blue)
![TypeScript](https://img.shields.io/badge/typescript-%3E5.0-blue)

## ⚡ Cosa fa

HanX è un addon per [Stremio](https://stremio.com) e [NUVIO](https://nuvio.app) che cerca e aggrega link di streaming per anime da tre fonti italiane:

- **AnimeUnity** — streaming diretto e proxy
- **AnimeSaturn** — streaming diretto e proxy
- **AnimeWorld** — streaming diretto e proxy

Supporta identificatori da **MyAnimeList**, **Kitsu**, **IMDb** e **TMDB**.

## ✨ Features

- 🔍 Ricerca multi-provider con fallback automatico
- 🌐 Supporto MediaFlow Proxy per streaming affidabile
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
| `TMDB_API_KEY` | Chiave API TMDB per metadata | — |
| `ANIMEUNITY_ENABLED` | Abilita AnimeUnity | `true` |
| `ANIMESATURN_ENABLED` | Abilita AnimeSaturn | `true` |
| `ANIMEWORLD_ENABLED` | Abilita AnimeWorld | `true` |
| `MFP_URL` | URL MediaFlow Proxy | — |
| `MFP_PSW` | Password MediaFlow Proxy | — |
| `TENRAI_API_BASE_URL` | Base API metadata MAL/Tenrai | `https://api.tenrai.org/v1` |
| `TENRAI_CACHE_DB_PATH` | SQLite persistente per titoli/ETag e limiter | `./data/tenrai-metadata.sqlite` |
| `TENRAI_CACHE_TTL_MS` | Massima freshness locale, mai superiore al `max-age` upstream | `3600000` |
| `TENRAI_MAX_REQUESTS_PER_SECOND` / `TENRAI_MAX_REQUESTS_PER_MINUTE` | Limiti conservativi per l’IP di uscita | `3` / `100` |

Le righe `.env.example` configurano Tenrai; puoi aggiungere le tue chiavi TMDB o MediaFlow nello stesso `.env`. Docker Compose persiste il database nel volume `hanx-data`. Le credenziali restano locali e non vanno committate.

Interfaccia web: `http://localhost:7000/`

## 🔌 API

| Endpoint | Descrizione |
|----------|-------------|
| `/stream/anime/{id}.json` | Stream per anime |
| `/stream/film/{id}.json` | Stream per film |
| `/stream/serie/{id}.json` | Stream per serie |

ID supportati: `mal:123`, `kitsu:123`, `tt1234567`, `tmdb:12345`

## 📁 Struttura

```
HanX/
├── src/
│   ├── addon.ts            # Entry point
│   ├── landingPage.ts      # UI web
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
- Le API esterne (Jikan, TMDB) devono essere raggiungibili dal server
- MediaFlow Proxy è opzionale ma consigliato

---

**HanX** — Anime streaming, semplificato.
