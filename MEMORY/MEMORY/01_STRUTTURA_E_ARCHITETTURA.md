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

> **Stato**: ⚠️ 5 vulnerabilità residue (rischio basso accettato)
> **Branch**: `security/migration-shx-removal` (pushato)
> **Audit**: 4 High + 1 Low in `stremio-addon-sdk` (non sfruttabili in produzione)

| Pacchetto | Stato | Nota |
|-----------|-------|------|
| `shx` | ❌ Rimosso | Sostituito con `scripts/build-copy.js` |
| `braces` | ❌ Rimosso | Era nella catena di shx — CVE-2026-93687 risolto |
| `path-to-regexp@0.1.7` | ⚠️ Accettato | In `stremio-addon-sdk > router` — non esposto |
| `tmp@0.0.33` | ⚠️ Accettato | In `stremio-addon-sdk > inquirer` — CLI only |

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
