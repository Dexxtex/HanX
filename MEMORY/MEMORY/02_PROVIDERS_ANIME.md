# 🎌 PROVIDERS ANIME E INFRASTRUTTURA — HanX

> **Verifica**: 10/10/2026 — FASE 8 COMPLETATA, addon anime-only

---

## PROVIDER PRINCIPALI

### 1. AnimeUnity (`src/providers/animeunity-provider.ts`)
- Scraping AnimeUnity, proxy support, cache multi-livello, retry automatico
- Dipendenze: anime-core, kitsu, animeGate
- In addon.ts: `scheduleProviderRun('AnimeUnity', ...)`

### 2. AnimeSaturn (`src/providers/animesaturn-provider.ts`)
- Scraping AnimeSaturn, base URL dinamico, path normalization
- Dipendenze: anime-core, kitsu, animeGate
- In addon.ts: `scheduleProviderRun('AnimeSaturn', ...)`

### 3. AnimeWorld (`src/providers/animeworld-provider.ts`)
- Scraping AnimeWorld, bypass Cloudflare SecurityAW2 (cookie challenge)
- Dipendenze: anime-core, kitsu, animeGate, flaresolverr
- In addon.ts: `scheduleProviderRun('AnimeWorld', ...)`

### 4. Kitsu (`src/providers/kitsu.ts`)
- API database anime per risoluzione titoli e metadati
- Dipendenze: anime-core

---

## INFRASTRUTTURA CONDIVISA (anime-core)

`src/providers/anime-core/`

| File | Descrizione |
|------|-----------|
| `index.ts` | Barrel export |
| `cache.ts` | Cache in-memory (getCached, setCached, uniqueStrings) |
| `fetch-resource.ts` | Fetch HTTP con cache e dedup inflight |
| `helpers.ts` | Parsing episode, normalizzazione, URL, BLOCKED_DOMAINS |
| `mapping-api.ts` | API mapping (animemapping.stremio.dpdns.org) |
| `provider-urls.ts` | Risoluzione URL provider da config/env |

---

## UTILITY ANIME

| File | Scopo |
|------|-------|
| `tmdbResolver.ts` | IMDB→TMDB mapping, playlist HLS |
| `animeGate.ts` | Verifica Stremio ID anime, normalizzazione titoli |
| `animeTitleResolver.ts` | Stremio IDs → titolo inglese (animemapping→Jikan→Kitsu→TMDB) |
| `unifiedNames.ts` | providerLabel, buildUnifiedStreamName, langToFlag |
| `shortenerResolver.ts` | Risoluzione URL shortener |
| `domains.ts` | Gestione domini dinamici |
| `mediaflow.ts` | Formattazione URL MediaFlow proxy |
| `packed.ts` | Decodifica packed/eval JavaScript |
| `config.ts` | Interfaccia Config da env vars |

---

## VIXSRC/VIXCLOUD

- `src/extractor.ts` (~1459 righe) — FASE 7b pulito ✅
- Funzioni TMDB spostate in `tmdbResolver.ts`
- Logica VixSrc/VixCloud essenziale mantenuta
- Endpoint mantenuti: VixSynthetic + Middleware Express

---

## 📊 STATO FILE RIMOSSI

| File | Motivazione |
|------|-------------|
| `easyproxyDvr.ts` | ❌ DVR non usato da anime, rimosso SF19d |
| `toon-provider.ts`, `toonitalia-provider.ts` | ❌ Provider non-anime |
| `sportzxUpdater.ts` … `epg.ts` (13 file) | ❌ Updater TV/Sport |
| `guardoserie.ts`, `guardaflix.ts`, `trailerProvider.ts` | ❌ Provider non-anime |
| `ppv_streams.py`, `scripts/uprot_resolver.py` | ❌ Script Python non-anime |

---

**HanX** — Addon Stremio/NUVIO esclusivo per anime.
