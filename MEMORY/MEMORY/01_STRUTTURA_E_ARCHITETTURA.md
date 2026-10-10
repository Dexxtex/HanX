# 🏗️ STRUTTURA E ARCHITETTURA — HanX

> **Verifica**: 10/10/2026 — FASE 8 COMPLETATA, addon anime-only

---

## 📁 STRUTTURA PROGETTO

```
HanX/
├── src/
│   ├── addon.ts              # Main anime addon (~1223 righe) ✅ FASE 8
│   ├── extractor.ts          # Stream extraction (~1459 righe) ✅ FASE 7b
│   ├── landingPage.ts        # Landing page (~774 righe) ✅ FASE 6
│   └── providers/
│       ├── anime-core/       # Infrastruttura condivisa anime
│       │   ├── animeunity-provider.ts
│       │   ├── animesaturn-provider.ts
│       │   ├── animeworld-provider.ts
│       │   ├── kitsu.ts
│       │   ├── flaresolverr.ts
│       │   └── ... (cache, helpers, mapping)
│       └── utils/
│           ├── animeTitleResolver.ts
│           ├── mediaflow.ts
│           ├── shortenerResolver.ts
│           └── unifiedNames.ts
├── config/
│   ├── domains.json
│   └── provider_urls.json
├── public/                   # Assets statici
├── memoria/                  # Documentazione progetto
├── Dockerfile
├── docker-compose.yml
└── package.json
```

---

## 🔄 FLUSSO RICHIESTA ANIME

```
Stremio Request → addon.ts (router anime)
  ├── Title Resolver (animeTitleResolver.ts)
  │   └── animemapping → Jikan → Kitsu → TMDB
  ├── Mapping API (anime-core/mapping-api.ts)
  ├── Provider (AU/AS/AW) → scraping + VixSrc embed
  ├── extractor.ts (VixCloud/VixSrc)
  │   ├── Token extraction, HLS manifest parsing
  │   └── Direct/Proxy/Synthetic streams
  ├── shortenerResolver.ts (se necessario)
  └── mediaflow.ts (proxy formatting)
```

---

## ⚙️ SISTEMA DI CACHE

- In-memory Map-based con TTL multi-livello
- SQLite persistenza opzionale tramite Keyv
- Dedup inflight request
- Provider cache con hash FNV-1a

---

## 🌐 SISTEMA DI PROXY

| Proxy | Stato | Note |
|-------|-------|------|
| **MediaFlow** | ✅ Attivo | Proxy esterno principale |
| **EasyProxy** | ✅ Attivo | Fallback alternativo |
| `easyproxyDvr.ts` | ❌ Rimosso | File DVR non usato |

---

## 🔑 AMBIENTE E DIPENDENZE

### Variabili d'ambiente

| Variabile | Scopo |
|-----------|-------|
| `PORT` | Porta server (default: 7000) |
| `TMDB_API_KEY` | Metadati anime |
| `MFP_URL`, `MFP_PSW` | MediaFlow proxy |
| `ANIME_GATE_ENABLED` | Gate verifica anime |
| `DEBUG_LOG` | Debug logging |

### Config fields (baseManifest)

| Campo | Note |
|-------|------|
| `tmdbApiKey`, `mediaFlowProxyUrl/Psw`, `useMediaFlow` | Infrastruttura |
| `animeunityEnabled/Direct/DirectFhd/Proxy` | AnimeUnity |
| `animesaturnEnabled`, `animeworldEnabled` | Provider toggle |
| `personalTmdbKey`, `mediaflowMaster` | UI helper |

---

## 📊 STATO FILE PRINCIPALI

| File | Righe | Stato |
|------|-------|-------|
| `addon.ts` | ~1223 | ✅ FASE 8 completata |
| `extractor.ts` | ~1459 | ✅ FASE 7b |
| `landingPage.ts` | ~774 | ✅ FASE 6 |

---

**HanX** — Addon Stremio/NUVIO esclusivo per anime.
