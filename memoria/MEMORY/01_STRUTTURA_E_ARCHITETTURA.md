# 🏗️ STRUTTURA, ARCHITETTURA E COMPONENTI

> **Verifica**: 10/10/2026 — SF1→SF18 + SF19a + SF19b + SF19c + SF19d completate, FASE 8 ~99%

## STRUTTURA PROGETTO

```
streamvix-main/
├── src/
│   ├── addon.ts              # Main anime addon (~1620 righe) ✅ FASE 8 quasi completa
│   ├── extractor.ts          # Stream extraction (1459 righe) ✅ FASE 7b
│   ├── landingPage.ts        # Landing page (774 righe) ✅ FASE 6
│   ├── providers/
│   │   ├── anime-core/       # Infrastruttura condivisa anime ✅
│   │   │   ├── index.ts, cache.ts, fetch-resource.ts
│   │   │   ├── helpers.ts, mapping-api.ts, provider-urls.ts
│   │   │   ├── animeunity-provider.ts, animesaturn-provider.ts
│   │   │   ├── animeworld-provider.ts, flaresolverr.ts, kitsu.ts
│   │   ├── utils/
│   │   │   ├── animeGate.ts, animeTitleResolver.ts, config.ts
│   │   │   ├── domains.ts, mediaflow.ts, packed.ts
│   │   │   ├── shortenerResolver.ts, tmdbResolver.ts, unifiedNames.ts
│   │   │   └── easyproxyDvr.ts → ❌ NON USATO DA ANIME (rimuovibile SF19d)
│   │   ├── types/animeunity.ts, sax.d.ts
│   │   ├── config/imdbToTmdb.json
│   │   └── public/ (backround.png, icon.png, landing.html)
├── config/
│   ├── domains.json, provider_urls.json
├── scripts/                  # Script utility anime
└── memoria/                  # Documentazione
```

## ARCHITETTURA ANIME (DOPO FASE 8)

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

## SISTEMA DI CACHE
- In-memory Map-based con TTL multi-livello (HTTP, page, stream, mapping)
- SQLite persistenza opzionale tramite Keyv
- Dedup inflight request

## SISTEMA DI PROXY
- **MediaFlow Proxy**: Proxy esterno per streaming (USATO DA ANIME)
- **EasyProxy**: Servizio proxy alternativo (USATO DA ANIME come fallback)
- ⚠️ `easyproxyDvr.ts` (FILE DVR, rimuovibile) ≠ **EasyProxy** (SERVIZIO, DA MANTENERE)

## AMBIENTE
- Node.js + TypeScript + Express.js (middleware extractor.ts)
- Stremio Addon SDK, Docker

## DIPENDENZE ENV — DA MANTENERE

| Variabile | Scopo |
|-----------|-------|
| `TMDB_API_KEY` | Metadati anime |
| `MFP_URL`, `MFP_PSW` | MediaFlow proxy streaming |
| `USE_MEDIA_FLOW` | Toggle proxy |
| `ANIMEUNITY/SATURN/WORLD_ENABLED` | Toggle provider |
| `AU/AS/AW_PROXY` | Proxy scraping provider |
| `PORT`, `DEBUG_LOG` | Server e debug |

## CONFIG FIELDS — DA MANTENERE (baseManifest)

| Campo | Note |
|-------|------|
| `tmdbApiKey`, `mediaFlowProxyUrl/Psw`, `useMediaFlow` | Infrastruttura anime |
| `animeunityEnabled/Direct/DirectFhd/Proxy` | AnimeUnity |
| `animesaturnEnabled`, `animeworldEnabled` | Provider toggle |
| `personalTmdbKey`, `mediaflowMaster` | UI helper (landingPage.ts) |

## CONFIG FIELDS — DA RIMUOVERE

`dvrEnabled`, `disableVixsrc`, `vixDirect/Fhd/Proxy`, `disableLiveTv`, `trailerEnabled`, `vidxgoEnabled`, `guardoserieEnabled`, `guardaflixEnabled`, `guardahdEnabled`, `adnEnabled`, `cinemacityEnabled`, `eurostreamingEnabled`, `toonitaliaEnabled`, `toonEnabled`, `cb01Enabled`, `vavooNoMfpEnabled`, `fastMode`

## FUNZIONI SHARED — SF18 (COMPLETATA)

| Funzione | Azione | Note |
|----------|--------|------|
| `hasAnyProviderSetting` | ✅ Snellita | providerKeys → solo anime |
| `isDirectAPICall` | ✅ Mantenuta | Flag anime |
| `envFlag` | ✅ Mantenuta | Helper flag |
| `_providerConfigSig` | ✅ Snellita | JSON.stringify → config anime |
| `reverseProviderKey` | ✅ Snellita | Mappature → solo anime |
| `unifyStreams` | ✅ Mantenuta | Chiamata da runProvider |
| `getFastPriority` | ✅ Snellita | Solo anime fast request |
| `rank()` | ✅ Snellita | Mappature → solo anime |
| `providerLabel()` | ✅ Mantenuta | Usato da scheduleProviderRun |
| `buildUnifiedStreamName()` | ✅ Mantenuta | Usato da anime |
| `mapLegacyProviderName()` | **Rimuovere** | Orfana dopo SF18 (SF19d) |

## MANIFEST TARGET (SF11)
- `id`: `"org.stremio.vixcloud"` | `types`: `["anime"]`
- `idPrefixes`: `["tt","kitsu","mal","tmdb"]`
- `resources`: `["stream", "catalog", "meta"]`
- `catalogs`: `[]` (rimossi 7 catalog non-anime)

## FUNZIONI SHARED — SF18 (SNELLIRE, NON RIMUOVERE)

| Funzione | Azione | Note |
|----------|--------|------|
| `hasAnyProviderSetting` | Snellire | providerKeys → solo anime |
| `isDirectAPICall` | Mantenere | Flag anime |
| `envFlag` | Mantenere | Helper flag |
| `_providerConfigSig` | Snellire | JSON.stringify → config anime |
| `reverseProviderKey` | Snellire | Mappature → solo anime |
| `unifyStreams` | Mantenere | Chiamata da runProvider |
| `getFastPriority` | Snellire | Mantenere `isAnimeFastRequest` |
| `rank()` | Snellire | Mappature → solo anime |
| `providerLabel()` | Mantenere | Usato da scheduleProviderRun |
| `buildUnifiedStreamName()` | Mantenere | Usato da anime |
| `mapLegacyProviderName()` | **Rimuovere** | Orfana dopo SF18 |

## NOTE RIGHE
- Usare SEMPRE conteggio **editor** (non terminale) per tutti i file
- `addon.ts`: ~10574 righe (iniziali) → ~6800 (dopo SF19b) → ~1845 (dopo SF19c) → ~1223 (dopo SF19e)

## STATO FASI

| Fase | Stato |
|------|-------|
| FASE 1-2 | ✅ Provider/Python eliminati |
| FASE 6 | ✅ landingPage.ts pulito |
| FASE 7b | ✅ extractor.ts pulito |
| FASE 8 | ✅ COMPLETATA (SF1→SF19e) — addon.ts ~1223 righe, tsc --noEmit pulito |
| FASE 9-11 | ⏳ Post-FASE 8 |
