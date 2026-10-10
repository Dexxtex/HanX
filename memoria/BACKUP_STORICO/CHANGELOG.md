# 📜 STORICO DEI CAMBIAMENTI — STREAMVIX

> **Stato**: 10/10/2026 — SF1→SF10 + SF18 + SF19a + SF19b + SF19c + SF19d completate, FASE 8 ~99%

---

## FASI PRE-FASE 8

| Fase | Data | Descrizione |
|------|------|-------------|
| FASE 1 | 09/10 | Provider non-anime eliminati (toon, toonitalia) + config |
| FASE 2 | 09/10 | File Python eliminati (ppv_streams, uprot_resolver) |
| FASE 5 | 09/10 | File updater sport/live TV eliminati dal filesystem |
| FASE 6 | 09/10 | landingPage.ts pulito (~1820 → ~774 righe, -58%) |
| FASE 7b | 09/10 | extractor.ts pulito (~1703 → 1459 righe, -14%) |

---

## FASE 8 — SOTTOFASI COMPLETATE (SF1→SF17)

### SF1 → SF4: Preparazione
| Sottofase | Cosa | Righe |
|-----------|------|-------|
| **SF1** | 16 import non-anime verso file eliminati rimossi | ~42 |
| **SF2** | 5 variabili flag non-anime rimosse (DISABLE_LIVE_EVENTS, IS_MH_DISABLED, ecc.) | 6 |
| **SF3** | 15 campi non-anime rimossi da interfaccia AddonConfig | — |
| **SF4** | 13 costanti Vavoo rimosse (VAVOO_DEBUG, VAVOO_WORKER_URLS, ecc.) | ~35 |

### SF5 → SF7: Funzioni Vavoo
| Sottofase | Cosa | Righe |
|-----------|------|-------|
| **SF5** | `getClientIpFromReq` rimossa (91 righe + helper) | 91 |
| **SF6** | `getTsSignature` + `buildTsFallbackUrl` rimosse | 18 |
| **SF7** | `resolveVavooCleanUrl` + ~60 call site rimossi | ~278 |

### SF8 → SF11: Pulizia globale
| Sottofase | Cosa | Righe |
|-----------|------|-------|
| **SF8a** | 6 elementi dead code mai usati (vavooCleanCache, dynamicStreamCache, ecc.) | ~60 |
| **SF9** | TV/EPG/DynamicChannels: vars, funzioni, watcher IIFE, endpoint /static/* | ~400+ |
| **SF11** | baseManifest: description/types/idPrefixes puliti, 19 config fields rimossi | ~145 |

### SF12 → SF17: createBuilder e handler
| Sottofase | Cosa | Righe |
|-----------|------|-------|
| **SF12** | Catalog filtering rimosso, builder.defineCatalogHandler (~595 righe) | ~625 |
| **SF13** | 8 meta handler sport/live rimossi (SPORTZX, SPORTS99, FREESHOT, ecc.) | ~200 |
| **SF14** | 7 stream handler sport/live rimossi (DVR, SPORTZX, SPORTS99, ecc.) | ~400 |
| **SF15** | 3 blocchi stream handler thisnot/rm/mpd (ON-DEMAND, static injection) | ~800 |
| **SF16** | GDPlayer + TVTap + dynamicHandled block (Freeshot, pa.cc, SPORTZX, SPORTS99) | ~637 |
| **SF17** | VavooClean vars + D_CF/Daddy synthesis + Vavoo cache/streams | ~600 |

### SF10: PPV scheduler + Vavoo cache
| Sottofase | Cosa | Righe |
|-----------|------|-------|
| **SF10** | PPV scheduler IIFE + VavooCache interface + cache funcs + alias funcs | ~244 |

### SF18 (completa — B1→B10): Config provider + snellimento funzioni shared
| Sottofase | Cosa | Righe |
|-----------|------|-------|
| **SF18-B1** | Flags provider snelliti (rimossi 13 flag non-anime) | ~66 |
| **SF18-B2** | _providerConfigSig + condizionale ingresso snelliti | ~20 |
| **SF18-B3** | reverseProviderKey snellita (solo anime + generic) | ~14 |
| **SF18-B4** | unifyStreams snellita (hostMap + bingeGroup) | ~40 |
| **SF18-B5** | getFastPriority snellita (solo anime) | ~3 |
| **SF18-B6** | getFastPriority confermato snellito | ~3 |
| **SF18-B7** | hasItalianStreams + pickFastModeStreams rimosse (orfane) | ~48 |
| **SF18-B8** | VixSrc parallel + 10 scheduleProviderRun non-anime rimossi | ~600 |
| **SF18-B9** | fastModeEnabled branch semplificato + post-process non-anime rimossi + VixSrc sequential fallback rimosso | ~100 |
| **SF18-B10** | rank() snellita (solo anime) | ~10 |

### SF19a → SF19d: Express, Admin/Debug, Scheduler, Cleanup
| Sottofase | Cosa | Righe |
|-----------|------|-------|
| **SF19a** | Express setup + middleware + routing base rimosso | ~958 |
| **SF19b** | Admin/Debug endpoints rimossi (VixSynthetic + Middleware mantenuti) | ~1248 |
| **SF19c** | Scheduler + startServer + ensureCacheDirectories + tutti gli auto-updater | ~944 |
| **SF19d** | Cleanup generale (import orfani, funzioni non usate, commenti, dead code, whitespace) | ~224 |

**Totale righe rimosse SF1→SF17**: ~4300+
**Totale righe rimosse SF10**: ~244
**Totale righe snellite/rimosse SF18 (B1-B10)**: ~900
**Totale righe rimosse SF19a**: ~958
**Totale righe rimosse SF19b**: ~1248
**Totale righe rimosse SF19c**: ~944
**Totale righe rimosse SF19d**: ~224

---

## ⏳ SOTTOFASI RIMANENTI (FASE 8)

| Sottofase | Cosa | Stima |
|-----------|------|-------|
| **SF18** | ✅ COMPLETATA (B1→B10) — Config provider + snellimento funzioni shared | ~900 |
| **SF19a** | ✅ COMPLETATA — Express setup + middleware + routing base rimosso (~958 righe) | ~957 |
| **SF19b** | ✅ COMPLETATA — Admin/Debug endpoints rimossi (~1248 righe), VixSynthetic + Middleware mantenuti | ~1248 |
| **SF19c** | ✅ COMPLETATA — Scheduler + startServer + ensureCacheDirectories rimossi (~944 righe) | ~944 |
| **SF19d** | ✅ COMPLETATA — Cleanup generale (import orfani, funzioni non usate, commenti non-anime, dead code, whitespace) ~224 righe rimosse | ~224 |
| **SF19e** | ✅ COMPLETATA — `tsc --noEmit` ✅ zero errori/zero warning, rimossi blocchi TV/DVR residui (~620 righe), rimosso file orfano `easyproxyDvr.ts`, manifest pulito. File finale: ~1223 righe | — |

**Ordine**: SF10 → SF18 → SF19a → SF19b → SF19c → SF19d → SF19e

---

## PROBLEMI E CORREZIONI IMPORTANTI

### 06/10 — Corruzione addon.ts via PowerShell
- PowerShell ha sovrascritto addon.ts con 2 bytes vuoti
- Recupero da GitHub necessario
- **Lezione**: NON usare PowerShell per file TS >100KB

### 09/10 — Import dinamici verso file eliminati
- `toon-provider`, `toonitalia-provider` import dinamici rimasti in addon.ts
- Non bloccano compilazione TypeScript ma rischiano runtime error
- **Lezione**: Cercare sia import statici che dinamici prima di eliminare file

### 09/10 — shortenerResolver.ts riferimenti a script eliminato
- `scripts/uprot_resolver.py` eliminato ma riferito in shortenerResolver.ts
- **Correzione**: `scriptPath()` restituisce null se script inesistente; fallback graceful

### 09/10 — Sf18 scope sottostimato
- SF18 stimata ~200 righe, realtà ~830
- `unifyStreams` e `getFastPriority` etichettate erroneamente come "non-anime"
- **Correzione**: Snellire invece di rimuovere (anime le usa)

### 10/10 — SF18 B1-B5 parziali → B6-B10 completati
- B1-B5 completati: flags, configSig, reverseProviderKey, unifyStreams, getFastPriority
- B6-B10 completati: hasItalianStreams/pickFastModeStreams rimosse, VixSrc+10 provider non-anime rimossi, fastModeEnabled semplificato, post-process non-anime rimossi, rank() snellita

---

## FILE ELIMINATI (riferimenti rimossi in SF1)

| File | Categoria |
|------|-----------|
| `toon-provider.ts`, `toonitalia-provider.ts` | Provider |
| `ppv_streams.py`, `scripts/uprot_resolver.py` | Python |
| `sportzxUpdater.ts` … `epg.ts` (13 file) | Updater TV/Sport |
| `guardoserie.ts`, `guardaflix.ts`, `trailerProvider.ts` | Provider non-anime |
| `config/toon_overrides.json`, `toonitalia-normalizations.json` | Config |

---

## PROSSIME AZIONI POST-FASE 8

- [ ] Verifica eliminazione file residui non-anime
- [ ] `tsc --noEmit` — zero errori
- [ ] Test provider anime (AU/AS/AW)
- [ ] Aggiornamento `README.md` per struttura anime-only
