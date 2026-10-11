# 🏗️ STRUTTURA E ARCHITETTURA — HanX

---

## 📁 STRUTTURA PROGETTO

```
HanX/
├── src/
│   ├── addon.ts              
│   ├── extractor.ts          
│   ├── landingPage.ts        
│   └── providers/
│       ├── anime-core/       # Infrastruttura condivisa anime
│       │   ├── animeunity-provider.ts
│       │   ├── animesaturn-provider.ts
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
├── scripts/
│   ├── build-copy.js         # Script build nativo (sostituisce shx)
│   └── check_domains.cjs
├── public/                   # Assets statici
├── MEMORY/                   # Documentazione progetto
├── Dockerfile
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml       # Override dipendenze vulnerabili
└── tsconfig.json
```

## 🔒 SICUREZZA

> **Stato**: ✅ Zero vulnerabilità (pnpm audit pulito)
> **Branch**: `security/migration-shx-removal` (pushato)

| Pacchetto | Stato | Nota |
|-----------|-------|------|
| `shx` | ❌ Rimosso | Sostituito con `scripts/build-copy.js` |
| `braces` | ❌ Rimosso | Era nella catena di shx |
| `path-to-regexp` | ✅ Override | `^0.1.13` in `pnpm-workspace.yaml` |
| `tmp` | ✅ Override | `^0.2.6` in `pnpm-workspace.yaml` |

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
- SQLite persistenza opzionale tramite `@keyv/sqlite`
- Dedup inflight request
- Provider cache con hash FNV-1a

---

## 🌐 SISTEMA DI PROXY

| Proxy | Stato | Note |
|-------|-------|------|
| **MediaFlow** | ✅ Attivo | Proxy esterno principale |
| **EasyProxy** | ✅ Attivo | Fallback alternativo |

---

## 🔑 AMBIENTE E DIPENDENZE

### Variabili d'ambiente (selezionate)

| Variabile | Scopo |
|-----------|-------|
| `PORT` | Porta server (default: 7000) |
| `TMDB_API_KEY` | Metadati anime |
| `MFP_URL`, `MFP_PSW` | MediaFlow proxy |
| `ANIME_GATE_ENABLED` | Gate verifica anime |
| `DEBUG_LOG` | Debug logging |
| `ADDON_BASE_URL` | URL base addon (opzionale) |

### Config fields (baseManifest)

| Campo | Note |
|-------|------|
| `tmdbApiKey`, `mediaFlowProxyUrl/Psw`, `useMediaFlow` | Infrastruttura |
| `animeunityEnabled/Direct/DirectFhd/Proxy` | AnimeUnity |
| `animesaturnEnabled`, `animeworldEnabled` | Provider toggle |
| `personalTmdbKey`, `mediaflowMaster` | UI helper |

---

**HanX** — Addon Stremio/NUVIO esclusivo per anime.
