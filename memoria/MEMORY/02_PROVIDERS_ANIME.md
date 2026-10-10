# 🎌 PROVIDERS ANIME E INFRASTRUTTURA

> **Verifica**: 10/10/2026 — SF1→SF18 + SF19a + SF19b + SF19c + SF19d completate

## PROVIDER PRINCIPALI

### 1. AnimeUnity (`src/providers/animeunity-provider.ts` — ~52KB)
- Scraping AnimeUnity, proxy support, cache multi-livello, retry automatico
- Dipendenze: anime-core, kitsu, animeGate
- In addon.ts: `scheduleProviderRun('AnimeUnity', ...)` — **MANTENERE**

### 2. AnimeSaturn (`src/providers/animesaturn-provider.ts` — ~52KB)
- Scraping AnimeSaturn, base URL dinamico, path normalization
- Dipendenze: anime-core, kitsu, animeGate
- In addon.ts: `scheduleProviderRun('AnimeSaturn', ...)` — **MANTENERE**

### 3. AnimeWorld (`src/providers/animeworld-provider.ts` — ~70KB)
- Scraping AnimeWorld, bypass Cloudflare SecurityAW2 (cookie challenge)
- Dipendenze: anime-core, kitsu, animeGate, flaresolverr
- In addon.ts: `scheduleProviderRun('AnimeWorld', ...)` — **MANTENERE**

### 4. Kitsu (`src/providers/kitsu.ts` — ~2.4KB)
- API database anime per risoluzione titoli e metadati
- Dipendenze: anime-core

## INFRASTRUTTURA CONDIVISA (anime-core)

`src/providers/anime-core/` (~40KB totale)

| File | Descrizione |
|------|-----------|
| `index.ts` | Barrel export |
| `cache.ts` | Cache in-memory (getCached, setCached, uniqueStrings) |
| `fetch-resource.ts` | Fetch HTTP con cache e dedup inflight |
| `helpers.ts` | Parsing episode, normalizzazione, URL, BLOCKED_DOMAINS |
| `mapping-api.ts` | API mapping (animemapping.stremio.dpdns.org) |
| `provider-urls.ts` | Risoluzione URL provider da config/env |

## UTILITY ANIME

| File | Scopo |
|------|-------|
| `tmdbResolver.ts` (~7KB) | IMDB→TMDB mapping, playlist HLS |
| `animeGate.ts` (~7KB) | Verifica Stremio ID anime, normalizzazione titoli |
| `animeTitleResolver.ts` (~22KB) | Stremio IDs → titolo inglese (animemapping→Jikan→Kitsu→TMDB) |
| `unifiedNames.ts` (~5KB) | providerLabel, buildUnifiedStreamName, langToFlag |
| `shortenerResolver.ts` (~24KB) | Risoluzione URL shortener |
| `domains.ts` (~1KB) | Gestione domini dinamici |
| `mediaflow.ts` (~1KB) | Formattazione URL MediaFlow proxy |
| `packed.ts` | Decodifica packed/eval JavaScript |
| `config.ts` | Interfaccia Config da env vars |
| `easyproxyDvr.ts` (~13KB) | ❌ NON USATO DA ANIME — solo DVR, rimuovibile SF19d |

## VIXSRC/VIXCLOUD

- `src/extractor.ts` (~60KB, 1459 righe) — FASE 7b pulito ✅
- Funzioni TMDB rimosse (ora in tmdbResolver.ts)
- Logica VixSrc/VixCloud essenziale mantenuta
- Endpoint mantenuti: VixSynthetic + Middleware Express
