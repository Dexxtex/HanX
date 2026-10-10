# 🎯 OBIETTIVI E STATO LAVORO

> **Verifica**: 10/10/2026 — SF1→SF18 + SF19a + SF19b + SF19c + SF19d completate, FASE 8 ~99%

## OBIETTIVO FINALE
Rendere StreamViX un addon **esclusivo per gli anime** rimuovendo tutto il codice non-anime.

---

## ✅ COSA E' FATTO

### Fasi pre-FASE 8
| Fase | Dettaglio |
|------|-----------|
| FASE 1 | Provider non-anime eliminati (toon, toonitalia) |
| FASE 2 | File Python eliminati (ppv_streams, uprot_resolver) |
| FASE 5 | File updater sport/live TV eliminati (import rimossi SF1) |
| FASE 6 | landingPage.ts pulito (~1820 → ~774 righe) |
| FASE 7b | extractor.ts pulito (~1703 → 1459 righe) |

### FASE 8 — SOTTOFASI COMPLETATE (SF1→SF17)

| Sottofase | Descrizione | Righe rimosse |
|-----------|-------------|---------------|
| SF1 | 16 import non-anime rimossi | ~42 |
| SF2 | 5 variabili flag non-anime rimosse | 6 |
| SF3 | 15 campi AddonConfig non-anime rimossi | — |
| SF4 | 13 costanti Vavoo rimosse | ~35 |
| SF5 | `getClientIpFromReq` rimossa | 91 |
| SF6 | `getTsSignature` + `buildTsFallbackUrl` rimosse | 18 |
| SF7 | `resolveVavooCleanUrl` + call site rimossi | ~278 |
| SF8a | 6 elementi dead code mai usati rimossi | ~60 |
| SF9 | TV/EPG/DynamicChannels vars e funzioni rimosse | ~400+ |
| SF11 | baseManifest pulito (7 catalog, 19 config) | ~145 |
| SF12 | Catalog filtering + createBuilder catalog handler | ~625 |
| SF13 | 8 meta handler sport/live rimossi | ~200 |
| SF14 | 7 stream handler sport/live rimossi | ~400 |
| SF15 | 3 stream handler thisnot/rm/mpd rimossi | ~800 |
| SF16 | GDPlayer + TVTap + dynamicHandled block rimossi | ~637 |
| SF17 | Vavoo + D_CF + Daddy stream handler rimossi | ~600 |

**Totale stimato rimosso**: ~4300+ righe

---

## ⏳ COSA MANCA (FASE 8)

| Sottofase | Descrizione | Stima |
|-----------|-------------|-------|
| **SF10** | PPV scheduler + Vavoo cache | righe ~1158-1420 |
| **SF18** | ✅ COMPLETATA — Config provider + snellimento funzioni shared (B1→B10) | ~900 |
| **SF19a** | ✅ COMPLETATA — Express setup + middleware + routing base rimosso (~958 righe) | ~957 |
| **SF19b** | ✅ COMPLETATA — Admin/Debug endpoints rimossi (~1248 righe), VixSynthetic + Middleware mantenuti | ~1248 |
| **SF19c** | ✅ COMPLETATA — Scheduler + startServer + ensureCacheDirectories rimossi (~944 righe) | ~944 |
| **SF19d** | ✅ COMPLETATA — Cleanup generale (import orfani, funzioni non usate, commenti non-anime, dead code, whitespace) ~224 righe rimosse | ~224 |
| **SF19e** | ✅ COMPLETATA — `tsc --noEmit` zero errori, rimossi blocchi TV/DVR residui, file orfano `easyproxyDvr.ts` eliminato | — |

**Ordine**: SF10 → SF18 → SF19a → SF19b → SF19c → SF19d → SF19e

---

## ⏳ POST-FASE 8

- [ ] Verifica eliminazione file residui non-anime
- [ ] `tsc --noEmit` — zero errori
- [ ] Test provider anime (AU/AS/AW)
- [ ] Aggiornamento `README.md` per struttura anime-only
- [ ] Aggiornamento `addon-config.json` description

---

## REGOLE CRITICHE

1. **EasyProxy DVR FILE** (`easyproxyDvr.ts`): NON USATO DA ANIME → rimuovibile in SF19d
2. **EasyProxy SERVIZIO**: Proxy alternativo a MediaFlow → **DA MANTENERE**
3. **Normalizzazioni anime**: NON modificare
4. **Dipendenze proxy**: `mediaFlowProxyUrl`, `mediaFlowProxyPassword`, `useMediaFlow`, `tmdbApiKey` → **NON TOCCARE**
5. **UI helper**: `personalTmdbKey`, `mediaflowMaster` → usati in landingPage.ts
6. **Righe**: Usare SEMPRE conteggio **editor**, mai terminale
7. **Prima di modificare addon.ts**: fare tutto su landingPage.ts, poi extractor.ts, poi addon.ts (ultimo)
