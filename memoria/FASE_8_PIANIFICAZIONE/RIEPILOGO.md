# 📊 FASE 8 — RIEPILOGO RAPIDO

> **File target**: `src/addon.ts` (~1223 righe)
> **Stato**: SF1→SF10 + SF18(B1-B10) + SF19a + SF19b + SF19c + SF19d + SF19e COMPLETATE ✅ — FASE 8 TERMINATA
> **Ultima revisione**: 10/10/2026 (SF10 + SF18 B1-B10 + SF19a + SF19b + SF19c + SF19d + SF19e completate)
> **Verifica incrociata**: Tutte le righe confermate con `read_file` (100% accurate)
> **Problema critico**: ✅ RISOLTO (SF1 — 16 import non-anime rimossi)
> **Stato attuale**: addon.ts compila pulito — `tsc --noEmit` ✅ zero errori, zero warning

---

## 📋 PIANIFICAZIONE COMPLETA

Tutti i dettagli delle 19 sottofasi, dipendenze e ordine di esecuzione sono in:
**`memoria/FASE_8_PIANIFICAZIONE/PIANIFICAZIONE_COMPLETA.md`**

---

## ✅ STATO CRITICO RISOLTO (SF1 — 09/10/2026)

I **16 file che NON ESISTEANO** sono stati rimossi in SF1.

| Categoria | Count | File |
|-----------|-------|------|
| Updater sport/live TV | 10 | sportzxUpdater, sports99Updater, mediahostingUpdater, freeshotUpdater, paccUpdater, sportstreamUpdater, mpdzUpdater, mpdpUpdater, rmUpdater, thisnotChannels |
| Utility | 3 | dynamicChannels, epg, gdplayerRuntime |
| Provider non-anime | 3 | guardoserie, guardaflix, trailerProvider |
| **TOTALE** | **16** | — |

## ✅ SF8a COMPLETATA (09/10/2026)

Rimossi **6 elementi dead code** mai usati:
- `vavooCleanCache`, `VAVOO_CLEAN_TTL_MS`, `dynamicStreamCache`, `DYNAMIC_STREAM_TTL_MS`, `resolveDynamicEventUrl()`, `isCfDlhdProxy()`

## ✅ SF12 COMPLETATA (09/10/2026)

Rimosso **catalog filtering completo** in createBuilder:
- effectiveManifest filtering IIFE (~30 righe)
- builder.defineCatalogHandler (~595 righe)
- Totali: ~625 righe rimosse

---

## ✅ SF11 COMPLETATA (09/10/2026)

Rimossi/modificati **5 elementi** del baseManifest:
- `description` — pulito, solo anime
- `types` — solo `["anime"]`
- `idPrefixes` — rimossi `tv`, `dvr`
- `catalogs` — tutti i 7 catalog non-anime rimossi → `[]`
- `config` — 19 campi non-anime rimossi, 12 mantenuti (infrastruttura + anime + UI helper)

---

## ✅ SF9 COMPLETATA (09/10/2026)

Rimossi/modificati **7 blocchi** TV/EPG/DynamicChannels:
- Variabili globali TV/EPG, funzioni helper statico, watcher IIFE
- Try/catch init sostituito con router init
- Funzioni orfane (buildVavooAliasIndex, getMergedTvChannelsCached)
- Endpoint /static/reload e /static/fupdate puliti

## ✅ SF13 COMPLETATA (09/10/2026)

Rimossi **8 meta handler** non-anime (~200 righe):
- effectiveDisableLiveTv, SPORTZX, SPORTS99, SPORTSTREAM, MEDIAHOSTING, FREESHOT, PA.CC, THISNOT
- Chiamata `getMergedTvChannelsCached()` sostituita con `tvChannels.find()` diretto
- ⚠️ `tvChannels` non definito (rimosso in SF9) → errore temporaneo previsto

## ✅ SF14 COMPLETATA (09/10/2026)

Rimossi **7 stream handler** non-anime (~400 righe):
- SPORTZX, SPORTS99, SPORTSTREAM, MEDIAHOSTING, FREESHOT, PA.CC, DVR
- MFP Config Block mantenuto (ancora usato da SF15+)
- Simboli orfani presenti ma senza call site → nessun errore

## ✅ SF15 COMPLETATA (10/10/2026)

Rimossi **3 blocchi discontinui** stream handler thisnot/rm/mpd (~800 righe totali):
- **Blocco 1** (1252-1354): TV channel catalog lookup + GDPlayer static injection
- **Blocco 2** (1450-2108): ON-DEMAND dynamic streams + MPD injections (MPDh/MPD/MPD2/MPDz/MPDp)
- **Blocco 3** (1544-1945): StaticUrl injections per non-dynamic (pdUrlF, staticUrlF, Freeshot, PA.CC, MediaHosting, SportStream, staticUrl, staticUrl2, etc.)
- ⚠️ `decodeStaticUrl` diventa orfana dopo SF15 (tutte le 12 call site rimosse)

## ✅ SF16 COMPLETATA (10/10/2026)

Rimossi **2 blocchi discontinui** GDPlayer + TVTap (~637 righe totali):
- **Blocco A** (~1450-1543): GDPlayer injection for dynamic (EXTRACTOR + PLACEHOLDER) + sortStreamsByPriority call + D_CF synthesis
- **Blocco B** (~1953-2495): dynamicHandled block completo (Freeshot/pa.cc reorder, SPORTZX, SPORTS99, MEDIAHOSTING, SPON, allowVavooClean, sortStreamsByPriority, DVR integration, TVTap integration)
- ⚠️ Righe reali sfalsate rispetto alla pianificazione (dopo rimozioni SF1-SF15)
- ✅ Funzioni GDPlayer (`resolveGdplayerForChannel`, `inferGdplayerSlug`) ancora usate in meta tagging (L~1019)
- ✅ `sortStreamsByPriority` ancora usata per static TV streams (L~3033)
- ✅ DVR funzioni ancora usate in static TV handler
- ✅ TVTap endpoint `/tvtap-resolve` separato, non toccato

## ✅ SF17 COMPLETATA (10/10/2026)

Rimossi **3 blocchi discontinui** Vavoo + D_CF + Daddy (~600 righe totali):
- **Blocco A** (~1252-1449): VavooClean vars + PPV early return + Z/AK/X-Eventi + Dynamic Vavoo injection
- **Blocco B** (~1457-1951): D_CF sintesi + staticUrlD_CF processing + staticUrlD Daddy + Vavoo cache lookup
- **Blocco C** (~1955-2005): VavooClean prepend + stream processing loop + direct Vavoo streams
- ✅ `DEFAULT_VAVOO_UA` → orfano dopo SF17 (cleanup post-SF17)
- ✅ `getStreamName` → orfano dopo SF17 (cleanup post-SF17)
- ✅ `extractDlhdIdFromCf` → orfano dopo SF17 (cleanup post-SF17)
- ✅ `buildCfProxyFromId` → orfano dopo SF17 (cleanup post-SF17)

## ✅ SF10 COMPLETATA (10/10/2026)

Rimosso **~244 righe** (blocco 470-713):
- PPV scheduler IIFE
- VavooCache interface + const vavooCache
- vavaoCachePath + auto-generate cache
- loadVavooCache, saveVavooCache, updateVavooCache
- vavooAliasIndex, normAlias, findBestAliasInTexts, resolveFirstVavooUrlForAlias

⚠️ Simboli NON rimossi (cleanup post-SF10):
- `execFilePromise` (L69-73) → orfano, rimuovere in cleanup post-SF10
- `util` import (L30) → orfano, rimuovere in cleanup post-SF10
- `spawn` import (L28) → ancora usato da SF19 X-Events
- `execFile` import (L28) → usato da SF19

## ✅ SF18 — COMPLETA (B1→B10) COMPLETATA (10/10/2026) [L122-156]

### B1 — Flags provider snelliti (~66 righe)
- `hasAnyProviderSetting`: providerKeys → solo anime (animesaturnEnabled, animeworldEnabled, animeunityEnabled)
- Rimossi: guardaSerieEnabled, vidxgoEnabled, cinemacityEnabled, guardaHdEnabled, adnEnabled, cb01Enabled, eurostreamingEnabled, toonitaliaEnabled, toonEnabled, vixsrcEnabled, guardoserieEnabled, guardaflixEnabled, trailerEnabled, fastModeEnabled
- Mantenuti: isDirectAPICall, envFlag, animeUnityEnabled, animeSaturnEnabled, animeWorldEnabled

### B2 — _providerConfigSig + condizionale ingresso snelliti (~20 righe)
- JSON.stringify: rimossi tutti i flag non-anime e config non-anime
- Mantenuti: !!animeUnityEnabled, !!animeSaturnEnabled, !!animeWorldEnabled, mfpUrl, mfpPsw, animeunityDirect/DirectFhd/Proxy
- Condizionale: solo (animeUnityEnabled || animeSaturnEnabled || animeWorldEnabled)

### B3 — reverseProviderKey snellita (~14 righe)
- Rimossi: vixsrc, guardaserie, vidxgo, cinemacity, guardahd, adn, cb01, eurostreaming, toonitalia, toon, guardaflix, guardoserie
- Mantenuti: anime unity→animeunity, anime saturn→animesaturn, anime world→animeworld, fallback→generic

### B4 — unifyStreams snellita (~40 righe)
- hostMap: rimossi vidxgo, cinemacity
- bingeGroup switch: rimossi eurostreaming, cb01, guardahd, guardaserie, vidxgo, cinemacity, adn, toonitalia, toon
- Mantenuti: animeunity/animeworld/animesaturn → std-ita/std-sub, default → providerKey-std

### B5 — getFastPriority snellita (~3 righe)
- Mantenuto: isAnimeFastRequest → ['animeunity', 'animeworld', 'animesaturn']
- Rimossi: case movie (vixsrc, guardahd, ecc.), case series (vixsrc, guardaserie, ecc.)

### B6→B10 — COMPLETATI
- B6: getFastPriority confermato snellito (solo anime)
- B7: hasItalianStreams + pickFastModeStreams rimosse (~48 righe)
- B8: VixSrc parallel + 10 scheduleProviderRun non-anime rimossi (~600 righe)
- B9: branch fastModeEnabled semplificato (~100 righe)
- B10: post-process ToonItalia/TOON + VixSrc sequential fallback rimossi
- B10: rank() snellita (solo anime unity/saturn/world)

---

## ✅ SF19b COMPLETATA (10/10/2026)

Rimossi **~1248 righe** di admin/debug endpoints:
- DLHD endpoints (`/dlhd`, `/dlhd.m3u8`, `/dlhd_key`) + import `./extractors/dlhd`
- TVTap resolve (`/tvtap-resolve/:channelId`) + `tvtapStreamCache` + `execFile` Python
- Health check (`/live`) + `runIpProbe()` + variabili live probe
- Live update (`/live/update`) + `executeLiveScript` + `purgeOldDynamicEvents` + `loadDynamicChannels`
- Live reload (`/live/reload`) + `invalidateDynamicChannels`
- ThisNot reload (`/tn/reload`) + `updateThisNotChannels`
- PPV reload (`/ppv/reload`) + `ppv_streams.py` + `execFile` child_process
- Static reload (`/static/reload`)
- RM update (`/rm/update`) + `updateRmChannels`
- MPDz update (`/mpdz/update`) + `updateMpdzChannels`
- MPDp update (`/mpdp/update`) + `updateMpdpChannels`
- Force update (`/static/fupdate`, `/tv/update`) + tutti i provider updaters
- Live purge (`/live/purge`) + `purgeOldDynamicEvents`
- Admin profiling (`/admin/cpu-profile/start`, `/admin/cpu-profile/stop`, `/admin/heap-snapshot`) + `inspector` + `v8`
- Admin cpu-stats (`/admin/cpu-stats`, `/admin/cpu-stats/reset`) + `_addonStats`
- Admin mode (`/admin/mode`) + `FAST_DYNAMIC`
- Debug fetch (`/debug/fetch` GET/POST) + `debugFetchHandler` + `axios` + proxy agents

**Mantenuti** (usati da codice anime in extractor.ts):
- VixSynthetic endpoint: GET `/vixsynthetic`, `/vixsynthetic.m3u8`
- Middleware Express principale (`app.use`)

---

## ✅ SF19c COMPLETATA (10/10/2026)

Rimossi **~944 righe** di scheduler + startServer + ensureCacheDirectories:
- `startServer()` function + auto-retry porta + `basePort` + chiamata
- `ensureCacheDirectories()` function + chiamata
- Startup auto-purge check (setTimeout 20s)
- LIVE Events Scheduler (Live.py) — scheduleNextLiveRun, executeLiveScript, computeDelayToNextRun, logLive, nowRome, liveRuns
- Bootstrap Live Run + auto-update 120s
- Auto purge scheduler (computeDelayToNextPurge, scheduleNextAutoPurge)
- Dynamic channels watcher (fs.watch)
- Daily 02:30 Rome reload (computeDelayToDailyReload, scheduleDailyReload)
- Amstaff commenter (commenti)
- RM auto-updater (startRmScheduler)
- ThisNot auto-updater (startThisNotUpdater)
- SportzX auto-updater (startSportzxScheduler)
- Sports99 auto-updater (startSports99Scheduler)
- SportStream auto-updater (startSportStreamScheduler)
- MediaHosting auto-updater (startMediaHostingScheduler)
- Freeshot auto-updater (startFreeshotScheduler)
- PA.CC auto-updater (startPaccScheduler)
- MPDz auto-updater (startMpdzScheduler)
- MPDp auto-updater (startMpdpScheduler)
- Z-Eventi scheduler (commenti)
- Z-Eventi playlist enrichment + endpoint /zeventi/update (~196 righe)
- AK-Eventi playlist enrichment + endpoint /akeventi/update (~192 righe)
- X-Eventi playlist enrichment + endpoint /xeventi/update + scheduler (~85 righe)

---

## ✅ SF19d COMPLETATA (10/10/2026)

Rimossi **~224 righe** di cleanup generale:
- Import orfani: `execFile`, `spawn` (child_process), `crypto`, `util` (non usati)
- Funzioni non chiamate: `decodeStaticUrl`, `decodeBase64`, `getChannelCategories`
- Variabili non usate: `execFilePromise`
- Commenti dead code: import Amstaff/ZEventi (file inesistenti), STREAMED/RBTV/SPSO enrichment (RIMOSSO)
- Commenti non-anime puliti: JSDoc getStreamPriority, provider cache, binge group, DLHD/Freeshot, SportZX debug
- Commento dead code: getClientIpFromReq/VAVOO_CLEAN (SF5)
- Whitespace: righe vuote duplicate rimosse

---

## 🔧 DECISIONE: Blocco MFP Config — Status Post-SF14

### Stato attuale
Il blocco MFP config (righe ~1196-1232) è **ancora presente** dopo SF14:
- `config`, `mfpUrl`, `mfpPsw`, `useMediaFlow` — **MANTENUTI**

### Uso variabili `mfpUrl`/`mfpPsw`/`useMediaFlow`

| Variabile | Usato da | Rimosso in |
|-----------|----------|------------|
| `mfpUrl` | ThisNot stream handler | ✅ **SF15** (Blocco 1 - RIMOSSO) |
| `mfpUrl` | TV channel catalog lookup | ✅ **SF15** (Blocco 1 - RIMOSSO) |
| `mfpUrl` | Z-Eventi, AK-Eventi, X-Eventi | ✅ **SF19c** (scheduler - RIMOSSO) |
| `mfpUrl` | VavooClean streams | **SF17** |
| `mfpUrl` | DLHD, P🐽D, Freeshot, MediaHosting, SportStream, TMDB runtime | ✅ **SF15** (Blocco 2 - RIMOSSO) |
| `mfpUrl` | GDPlayer injection dynamic | ✅ **SF16** (RIMOSSO) |
| `mfpUrl` | SPORTZX/SPORTS99/MEDIAHOSTING/SPON injection | ✅ **SF16** (RIMOSSO) |
| `mfpUrl` | TVTap integration | ✅ **SF16** (RIMOSSO) |
| `mfpUrl` | DVR dynamic events | ✅ **SF16** (RIMOSSO) |

### Conclusione
- **Dopo SF15 (COMPLETATA)**: Stream handler thisnot/rm/mpd rimossi
- **Dopo SF16 (COMPLETATA)**: GDPlayer injection, SPORTZX/SPORTS99/MEDIAHOSTING/SPON, TVTap, DVR dynamic rimossi
- **Dopo SF17**: Tutti gli stream handler che usano `mfpUrl`/`mfpPsw`/`useMediaFlow` sono stati rimossi
- **Dopo SF19c (COMPLETATA)**: Z-Eventi, AK-Eventi, X-Eventi scheduler rimossi
- Le variabili `mfpUrl`/`mfpPsw`/`useMediaFlow` sono **orfane** → blocco MFP config rimovibile in SF19d

### Decisione
- **Rimuovere in SF19d** — tutti i call site `mfpUrl`/`mfpPsw`/`useMediaFlow` sono stati rimossi (SF15, SF16, SF17, SF19c)
- Il blocco MFP config è ora orfano e può essere rimosso nella prossima sottofase

---

## 🔑 ORDINE DI ESECUZIONE (RIEPILOGO)

```
FASE PREPARATORIA:    SF1 → SF2 → SF3 → SF4
FASE VAVOO CORE:      SF8a → SF8b (SF4-SF7 completate ✅)
FASE GLOBALI:         SF9 → SF11
FASE createBuilder:   SF12 → SF13 → SF14 → SF15 → SF16 → SF17 → SF10
FASE FINALIZZAZIONE:  SF18 → SF19a → SF19b → SF19c → SF19d → SF19e
```

> ⚠️ **SF19c completata**: Scheduler, startServer, ensureCacheDirectories, tutti gli auto-updater sport/live TV rimossi.
> ⚠️ **SF19d completata**: Cleanup generale — import orfani, funzioni non usate, commenti non-anime, dead code, whitespace.

> ⚠️ **SF10 spostato dopo SF17**: vavooCache è usato da resolveFirstVavooUrlForAlias() e createBuilder(). SF17 rimuove questi call site. SF10 prima di SF17 → 10+ errori di compilazione.

### Progresso FASE 8 al 10/10/2026

| Sottofasi | Stato | Righe rimosse (approx) |
|-----------|-------|------------------------|
| SF1→SF4 | ✅ Completate | ~200 |
| SF5→SF8b | ✅ Completate | ~350 |
| SF9→SF11 | ✅ Completate | ~1500 |
| SF12→SF14 | ✅ Completate | ~1000 |
| SF15 | ✅ Completata | ~800 |
| SF16 | ✅ Completata | ~637 |
| SF17 | ✅ Completata | ~600 |
| SF10→SF18 | ✅ Completate | ~244 |
| SF19a | ✅ Completata | ~958 |
| SF19b | ✅ Completata | ~1248 |
| SF19c | ✅ Completata | ~944 |
| SF19d | ✅ Completata | ~224 |

### Dipendenze critiche:
- **SF8a**: va DOPO SF7 (rimuove elementi orfani dopo resolveVavooCleanUrl)
- **SF16 prima di SF17**: SF16 (4564-4657, 5613-6155) e SF17 (3652-3904, 5062-5611, 6159-6209) sono adiacenti — SF16 deve eseguire prima
- **SF8b prima di SF12/SF15/SF16**: elementi non-orfani usati da queste sottofasi
- **SF17 prima di SF10**: SF17 rimuove vavooCache in createBuilder e resolveFirstVavooUrlForAlias call site → SF10 può rimuovere vavooCache senza errori
- **SF15 ha 3 blocchi discontinui**: 3477-3651, 3905-4563, 4658-5059 (NON rimuovere 3652-3904 VavooClean né 5062-5611 D_CF/Vavoo né 6159-6209 VavooClean prepend) — ✅ SF16 GDPlayer+TVTap già rimosso

---

## OBIETTIVO

| Metrica | Prima | Dopo SF19d |
|---------|-------|-----------|
| Righe addon.ts | ~10574 | ~1620 |
| Dimensioni | ~600KB | ~95KB |
| Riduzione (SF1→SF19d) | — | ~85% |
| Compilazione | ❌ NON COMPILA (16 import) | ✅ COMPILA (SF1 ✅) |

| Metrica | Dopo SF19d | Target Finale |
|---------|-----------|---------------|
| Righe addon.ts | ~1620 | ~1500-1800 ✅ |
| Dimensioni | ~95KB | ~80-100KB ✅ |

---

## 📂 FILE DI DOCUMENTAZIONE FASE 8

| File | Descrizione |
|------|-------------|
| `PIANIFICAZIONE_COMPLETA.md` | Pianificazione dettagliata 19 sottofasi, dipendenze, ordine esecuzione |
| `RIEPILOGO.md` | Questo file — riepilogo rapido con stato SF1→SF19d |
| `CHANGELOG.md` | Storico completo delle sessioni di pulizia |
| `ERRORI.md` | Registro errori e lezioni apprese |
| `MEMORY/` | Documentazione struttura, providers, architettura, obiettivi |

---

## ✅ VERIFICA INCROCIATA COMPLETA (09/10/2026)

Tutti i riferimenti alle righe di `addon.ts` sono stati verificati con `read_file`:

| Elemento | Stato |
|----------|-------|
| Righe funzioni (SF1-SF8) | ✅ Tutte corrette |
| Call site `resolveVavooCleanUrl` (3845, 5544, 5594) | ✅ Confermati |
| Riferimenti `vavooCache` in createBuilder (5 punti) | ✅ Confermati (L5466,5468,5477,5496,5562) |
| Riferimenti `vavooCache` in resolveFirstVavooUrlForAlias (4 punti) | ✅ Confermati (L1390,1394,1402,1411) |
| `execFilePromise` usi (2 punti: SF10) | ✅ Confermata orfana dopo SF10 |
| `spawn` import sopravvive a SF10 (usato da SF19 X-Events) | ✅ Confermato |
| Call site `getClientIpFromReq` (3841, 5532, 5582) | ✅ Corretti in SF5 |
| Call site `DEFAULT_VAVOO_UA` (411, 445, 482) | ✅ Confermati |
| Call site `getStreamName` (6 totali) | ✅ Confermati |
| Call site `getChannelCategories` (3 reali + 1 commento) | ✅ Confermati |
| Call site `decodeStaticUrl` (12 in createBuilder) | ✅ Confermati → tutti rimossi in SF15 |
| Call site `extractDlhdIdFromCf` (6 in createBuilder) | ✅ Confermati |
| Call site `buildCfProxyFromId` (4 in createBuilder) | ✅ Confermati |
| Call site `sortStreamsByPriority` / `getStreamPriority` (4 ciascuno) | ✅ Confermati → 2 call rimosse in SF16, 1 residua static TV |
| SF16: GDPlayer injection (EXTRACTOR + PLACEHOLDER) | ✅ RIMOSSO (1450-1543) |
| SF16: dynamicHandled block (Freeshot/SPORTZX/SPORTS99/MEDIAHOSTING/SPON/allowVavooClean/sortStreamsByPriority/DVR/TVTap) | ✅ RIMOSSO (1953-2495) |
| SF16: `resolveGdplayerForChannel` call site in createBuilder | ✅ RIMOSSE (meta tagging L~1019 preservato) |
| SF16: TVTap integration (execFile python3) | ✅ RIMOSSO (endpoint /tvtap-resolve separato preservato) |
| Variabili SF8a (orfane) e SF8b (non-orfane) | ✅ Tutte verificate |

**Correzioni applicate**: SF5 call site `5533,5581` → `5532,5582` (uniformati alla realtà)

> ⚠️ **Nota**: Non usare mai `grep` per verifiche di righe esatte — mostra intervalli di contesto, non la riga precisa.

---

## 📊 STATO AGGIORNATO POST-SF19d

| Simbolo | Stato dopo SF19d | Note |
|---------|------------------|------|
| `DISABLE_LIVE_EVENTS` | ✅ Orfano — nessun riferimento in addon.ts | Variabile globale rimossa implicitamente |
| `spawn` import | ✅ RIMOSSO in SF19d | Orfano, eliminato |
| `execFile` import | ✅ RIMOSSO in SF19d | Orfano, eliminato |
| `child_process` import | ✅ RIMOSSO in SF19d | Orfano, eliminato |
| `crypto` import | ✅ RIMOSSO in SF19d | Orfano, eliminato |
| `util` import | ✅ RIMOSSO in SF19d | Orfano, eliminato |
| `execFilePromise` | ✅ RIMOSSO in SF19d | Orfano, eliminato |
| `decodeStaticUrl` | ✅ RIMOSSO in SF19d | Mai chiamata, eliminata |
| `decodeBase64` | ✅ RIMOSSO in SF19d | Orfana dopo decodeStaticUrl |
| `getChannelCategories` | ✅ RIMOSSO in SF19d | Mai chiamata |
| `mapLegacyProviderName` | ✅ RIMOSSO in SF19d | Orfano dopo SF18 |
| `scheduleProviderRun` | ✅ Mantenuto | Usato da scheduler anime (B8) |
| `app` (Express) | ✅ Mantenuto | VixSynthetic endpoint usa app |

---

## 🔒 PROTEZIONE CODICE ANIME (VERIFICA 09/10/2026)

Verifica completa che nessun simbolo anime sia a rischio di rimozione accidentale:

| Simbolo anime | Rischi | Stato |
|---------------|--------|-------|
| `providerLabel()` | SF19d cleanup | ✅ PROTETTO — "DA MANTENERE, usato da anime" |
| `buildUnifiedStreamName()` | SF19d cleanup | ✅ PROTETTO — usato da anime |
| `unifyStreams` | SF18 B5 | ✅ PROTETTO — "SNELLIRE, NON RIMUOVERE" |
| `getFastPriority` | SF18 B6 | ✅ PROTETTO — mantenuto caso `isAnimeFastRequest` |
| `reverseProviderKey` | SF18 B4 | ✅ PROTETTO — mantenute mappature anime |
| `_providerConfigSig` | SF18 B3 | ✅ PROTETTO — mantenute config anime |
| `animeUnityEnabled/SaturnEnabled/WorldEnabled` | SF18 B1 | ✅ PROTETTO — "MANTENERE — ANIME" |
| `isDirectAPICall` | SF18 B1 | ✅ PROTETTO — "MANTENERE" |
| `envFlag` | SF18 B1 | ✅ PROTETTO — "MANTENERE" |
| `hasAnyProviderSetting` | SF18 B1 | ✅ PROTETTO — snellito (providerKeys → solo anime) |
| `rank()` | SF18 B10 | ✅ PROTETTO — mantenute mappature anime |
| `scheduleProviderRun anime` | SF18 B7 | ✅ PROTETTO — mantenuti AU/AS/AW |
| `AnimeUnity FHD badge` | SF18 B9 | ✅ PROTETTO — "Mantieni" |
| `spawn` import | SF10 | ✅ PROTETTO — "DA NON RIMUOVERE (X-Events)" |
| `execFile` import | SF10 | ✅ PROTETTO — "DA NON RIMUOVERE (SF19)" |
| SF16 completata | 10/10/2026 | ✅ GDPlayer + TVTap + dynamicHandled block rimossi (~637 righe) |
| `VixSynthetic` | SF19b | ✅ PROTETTO — "MANTENUTI per extractor.ts" |
| `Middleware Express` | SF19b | ✅ PROTETTO — "MANTENUTI per extractor.ts" |
| `configCache` | SF8b | ✅ PROTETTO — "NON rimuovere" |
| `DEFAULT_VAVOO_UA` | SF4, SF7, SF8b | ✅ PROTETTO — fuori range SF4/SF7, non-orfano SF8b |

---

## 🚀 STATO ESECUZIONE

- [x] Pianificazione completata e verificata
- [x] Dipendenze critiche mappate
- [x] **Range righe corretti (SF15: 3 blocchi, SF16: 2 blocchi [righe reali sfalsate ~1450-1543, ~1953-2495 dopo SF1-SF15], SF17: 3 blocchi 3652-3904+5062-5611+6159-6209, SF18: L6311-7259 ~830 righe in 10 blocchi, ordine esecuzione)**
- [x] Errori nella pianificazione originale corretti
- [x] **Verifica incrociata completa** — 100% accuratezza righe confermata
- [x] **SF9 aggiornata** — 7 blocchi, ~1550 righe, dipendenze SF1/SF2/SF8b/SF10/SF19 mappate
- [x] **SF10 corretta** — spostata dopo SF17, aggiunti tutti i simboli orfani (resolveFirstVavooUrlForAlias, findBestAliasInTexts, vavaoCachePath typo, execFilePromise)
- [x] **Diagramma dipendenze aggiornato** — SF17 → SF10 → SF18
- [x] **SF11 corretta** — rinumerazione da 20 a 19 sottofasi: SF11=baseManifest, SF12=catalog filtering, SF13=meta handler, SF14=stream handler sport, SF15=stream handler thisnot/rm/mpd, SF16=TVTap+GDPlayer, SF17=vavoo+D_CF+Daddy, SF18=provider config, SF19=admin endpoints
- [x] **SF18 corretta (09/10/2026)** — scope aggiornato: ~830 righe (non ~200), 10 blocchi. unifyStreams e getFastPriority SNELLITI (non rimossi, sono shared con anime). Blocco funzioni ORFANE: pickFastModeStreams + hasItalianStreams (solo non-anime). Blocco rimozione intera: 10 blocchi scheduleProviderRun non-anime (L6873-7142).
- [x] **SF18 corretta (09/10/2026 — seconda verifica)** — B2/B3 riepilogo righe allineati con blocchi dettagliati (ordine esecuzione). Riepilogo B1-B10 spostato in cima alla sezione SF18 (prima di BLOCCO 1). VixSrc verificato: presente SOLO in sezioni "Rimuovi", mai in "Mantieni" in nessun blocco. fastModeEnabled confermato non-utile anime: in fast mode sceglie SOLO il primo provider con stream (perdita di stream anime), il comportamento default (parallelo) è corretto. Rimosso come orfano.
- [x] **SF19 suddivisa (09/10/2026 — seconda suddivisione)** — SF19 → SF19a (Express setup + middleware, ~957 righe, L7315-8272), SF19b (Admin/Debug endpoints, ~1248 righe, L8407-9628 — VixSynthetic L8276-8405 e Middleware Express L8478-8569 MANTENUTI per extractor.ts), SF19c (Scheduler + startServer, ~944 righe, L9630-10574), SF19d (cleanup generale codice, nessun range fisso), SF19e (verifica compilazione + test, nessun range fisso). Diagramma dipendenze e ordine esecuzione aggiornati.
- [x] **SF19c completata (10/10/2026)** — Scheduler + startServer + ensureCacheDirectories rimossi (~944 righe, L1845-2788 → file ora ~1845 righe). Rimossi: startServer, ensureCacheDirectories, auto-purge, Live.py scheduler, bootstrap live, auto purge scheduler, dynamic channels watcher, daily reload, tutti gli auto-updater (RM, ThisNot, SportzX, Sports99, SportStream, MediaHosting, Freeshot, PA.CC, MPDz, MPDp, Z-Eventi, AK-Eventi, X-Eventi). File ora termina con console.log avvio.
- [x] **SF15/SF16/SF17 corretti** — range SF16 corretto (4564-4657, 5613-6155), allowVavooClean Dynamic gate e sortStreamsByPriority TV spostati da SF17 a SF16, normAlias orfana dopo SF15
- [x] **SF19a completata (10/10/2026)** — Express setup + middleware + routing base rimosso (~958 righe, L1613-2571). Mantenuto solo `const app = express()` per VixSynthetic (SF19b). Verificato: nessun codice anime usa Express diretto.
- [x] **SF19d completata (10/10/2026)** — Cleanup generale: import orfani (child_process, crypto, util), funzioni non usate (decodeStaticUrl, decodeBase64, getChannelCategories, execFilePromise), commenti non-anime puliti, dead code rimosso, whitespace corretto (~224 righe)
- [x] **SF15 completata (10/10/2026)** — 3 blocchi rimossi (~800 righe), decodeStaticUrl orfana
- [x] **SF16 completata (10/10/2026)** — 2 blocchi rimossi (~637 righe): GDPlayer injection EXTRACTOR/PLACEHOLDER, dynamicHandled block completo (Freeshot/pa.cc/SPORTZX/SPORTS99/MEDIAHOSTING/SPON/allowVavooClean/sortStreamsByPriority/DVR/TVTap). Righe reali sfalsate rispetto pianificazione.
- [x] **SF17 completata (10/10/2026)** — 3 blocchi rimossi (~600 righe): VavooClean vars + D_CF/Vavoo + VavooClean prepend
- [x] **SF19e completata (10/10/2026)** — `tsc --noEmit` ✅ zero errori, rimossi blocchi TV/DVR residui (~620 righe), rimosso file orfano `easyproxyDvr.ts`, manifest pulito. FASE 8 TERMINATA.
- [x] **Protezione codice anime verificata (09/10/2026)** — 18 simboli anime protetti, nessun rischio rimozione accidentale
- [x] **SF1 completata** — 16 import non-anime rimossi (risolto problema compilazione)
- [x] **SF15 completata** — 3 blocchi stream handler rimossi (~800 righe, 10/10/2026)
- [x] **SF2** — Variabili flag non-anime rimosse ✅ (09/10/2026)
- [x] **SF3** — Campi non-anime rimossi da AddonConfig ✅ (09/10/2026)
- [x] **SF4** — Costanti Vavoo rimosse ✅ (13 simboli, 09/10/2026)
- [x] **SF5** — getClientIpFromReq rimossa ✅ (91 righe, 09/10/2026)
- [x] **SF19a** — Express setup + middleware + routing base rimosso ✅ (~958 righe, 10/10/2026 — mantenuto `const app = express()` per VixSynthetic)
- [x] **SF19b** — Admin/Debug endpoints rimossi ✅ (~1248 righe, 10/10/2026 — VixSynthetic + Middleware Express mantenuti per extractor.ts)
- [x] **SF19c** — Scheduler + startServer + ensureCacheDirectories rimossi ✅ (~944 righe, 10/10/2026 — file ora ~1845 righe)
- [x] **SF6** — getTsSignature + buildTsFallbackUrl rimosse ✅ (18 righe, 09/10/2026 — 1 call site residuo in resolveVavooCleanUrl da rimuovere in SF7)
- [x] **SF7** — resolveVavooCleanUrl rimossa ✅ (218 righe + ~60 call site, 09/10/2026 — 2 riferimenti getClientIpFromReq commentati per SF19a/SF19b)
- [x] **SF17** — Vavoo + D_CF + Daddy stream handler rimossi ✅ (~600 righe, 10/10/2026)
- [x] **FASE 8** — ✅ COMPLETATA (SF1→SF19e, 10/10/2026)

> **Nota**: Prima di eseguire qualsiasi sottofase, fare backup di `src/addon.ts`.
