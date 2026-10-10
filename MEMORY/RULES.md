# 📜 Regole di Sviluppo — HanX

> **Aggiornamento**: 10/10/2026 — FASE 8 COMPLETATA

---

## 🚨 REGOLE FONDAMENTALI

1. **Chiedere sempre prima** di iniziare azioni significative
2. **Interrompere tutto** se l'utente rifiuta la proposta
3. **Leggere questo file** prima di ogni sessione di lavoro

---

## 🎯 OBIETTIVO PROGETTO

**HanX** è un addon Stremio/NUVIO **esclusivo per anime**:
- Provider: AnimeUnity, AnimeSaturn, AnimeWorld
- Codice non-anime: ✅ RIMOSSO (FASE 8 completata)
- Infrastruttura: ✅ MANTENUTA (proxy, cache, mapping)

---

## 📁 STRUTTURA DOCUMENTAZIONE

| Cartella | Scopo |
|----------|-------|
| `memoria/MEMORY/` | Documentazione tecnica (max 3 file) |
| `memoria/BACKUP_STORICO/` | Storico cambiamenti (dimensione libera) |
| `memoria/ERROR_TRACKING/` | Registro errori e lezioni |

**File MEMORY:**
- `01_STRUTTURA_E_ARCHITETTURA.md` — Architettura e componenti
- `02_PROVIDERS_ANIME.md` — Provider e utility
- `03_OBIETTIVI_E_TODO.md` — Obiettivi e stato lavoro

---

## ⚠️ FILE DA NON MODIFICARE

| File/Campo | Stato | Note |
|------------|-------|------|
| `easyproxyDvr.ts` | ✅ RIMOSSO | DVR non usato da anime |
| **EasyProxy SERVIZIO** | ✅ MANTENERE | Proxy alternativo |
| Normalizzazioni anime | ✅ MANTENERE | Non modificare |
| `mediaFlowProxyUrl/Psw` | ✅ MANTENERE | Infrastruttura proxy |
| `tmdbApiKey` | ✅ MANTENERE | Metadati anime |
| `personalTmdbKey` | ✅ MANTENERE | UI helper (landingPage) |
| `mediaflowMaster` | ✅ MANTENERE | UI helper (landingPage) |

---

## 🔄 ORDINE MODIFICHE

Quando si modifica il codice, seguire questo ordine:

1. **landingPage.ts** — Interfaccia web
2. **extractor.ts** — Estrazione stream
3. **addon.ts** — Main addon (ultimo)
4. **Test compilazione** — `tsc --noEmit`

---

## 📏 REGOLA NUMERI DI RIGA

- Usare SEMPRE il conteggio dell'**editor** (non terminale)
- Il terminale conta diversamente (ignora righe vuote, newline)
- **Esempio**: `addon.ts` = ~1223 righe (editor), non usare `wc -l`
- Per verifiche esatte: `read_file` con `start_line`/`end_line`
- **NO `grep`** per numeri di riga esatti (mostra solo intervalli)

---

## ✅ AGGIORNAMENTO DOCUMENTAZIONE

- **AD OGNI SESSIONE**: aggiornare `memoria/`
- **NO file superflui**: non creare directory non necessarie
- **Rimuovere**: correlazioni, dipendenze, import non-anime

---

**HanX** — Addon Stremio/NUVIO esclusivo per anime.
