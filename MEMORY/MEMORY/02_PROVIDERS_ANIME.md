# 🎌 PROVIDERS ANIME E INFRASTRUTTURA — HanX

> **Verifica**: 11/10/2026 — ROADMAP 9/9 COMPLETATA, addon anime-only
> **Sicurezza**: ⚠️ 5 vulnerabilità residue in `stremio-addon-sdk` (rischio basso accettato)

---

## PROVIDER PRINCIPALI

### 1. AnimeUnity (`src/providers/animeunity-provider.ts`)
- Scraping AnimeUnity, proxy support, cache multi-livello, retry automatico
- Dipendenze: anime-core, animeGate
- In addon.ts: `scheduleProviderRun('AnimeUnity', ...)`

### 2. AnimeSaturn (`src/providers/animesaturn-provider.ts`)
- Scraping AnimeSaturn, base URL dinamico, path normalization
- Dipendenze: anime-core, animeGate
- In addon.ts: `scheduleProviderRun('AnimeSaturn', ...)`

### 3. AnimeWorld (`src/providers/animeworld-provider.ts`)
- Scraping AnimeWorld, bypass Cloudflare SecurityAW2 (cookie challenge)
- Dipendenze: anime-core, animeGate
- In addon.ts: `scheduleProviderRun('AnimeWorld', ...)`

---

## INFRASTRUTTURA CONDIVISA (anime-core)

`src/providers/anime-core/`

| File | Descrizione |
|------|-----------|
| `index.ts` | Barrel export |
| `cache.ts` | Cache in-memory (getCached, setCached, uniqueStrings) |
| `fetch-resource.ts` | Fetch HTTP con cache e dedup inflight |
| `helpers.ts` | Parsing episode, normalizzazione, URL, BLOCKED_DOMAINS |
| `provider-urls.ts` | Risoluzione URL provider da config/env |

---

## MAPPING ANIME (`src/mapping/`)

| File | Scopo |
|------|-------|
| `request.ts` | Parsing ID Stremio/Nuvio (`kitsu`, `imdb`, `tmdb`, `tvdb`, `mal`) |
| `index.ts` | Indice locale versionato + risoluzione `{kitsuId, kitsuEpisode, title}` |
| `live.ts` | Fallback API ufficiali: Kitsu, TMDB, TVDB v4 (aired order) |
| `data/anime-seasons.json` | Indice generato, schema v1 |
| `overrides.json` | Override manuali |

Generazione: `pnpm mapping:build` (richiede `TMDB_API_KEY` e `TVDB_API_KEY`), validazione `pnpm mapping:check`.

---

## UTILITY ANIME

| File | Scopo |
|------|-------|
| `tmdbResolver.ts` | IMDB→TMDB mapping, playlist HLS |
| `animeGate.ts` | Verifica Stremio ID anime, normalizzazione titoli |
| `unifiedNames.ts` | Etichette provider (`providerLabel`) |
| `shortenerResolver.ts` | Risoluzione URL shortener |
| `domains.ts` | Gestione domini dinamici |
| `easyproxy.ts` | Costruzione URL EasyProxy |

---

## VIXSRC/VIXCLOUD

- `src/extractor.ts` - pulito ✅
- Funzioni TMDB spostate in `tmdbResolver.ts`
- Logica VixSrc/VixCloud essenziale mantenuta
- Endpoint mantenuti: VixSynthetic + Middleware Express

---

**HanX** — Addon Stremio/NUVIO esclusivo per anime.
