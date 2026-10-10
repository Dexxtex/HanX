# 🐛 Error Tracking — HanX

Registro degli errori critici e lezioni apprese durante lo sviluppo.

---

## ⚠️ ERRORI CRITICI (Da non ripetere)

### 1. Corruzione file con PowerShell
- **Cosa**: PowerShell ha sovrascritto `addon.ts` con 2 bytes vuoti
- **Causa**: Syntax error nella pipeline
- **Lezione**: **NON usare mai PowerShell** per modificare file TypeScript >100KB
- **Prevenzione**: Usare sempre editor tool per modifiche precise

### 2. Import verso file eliminati
- **Cosa**: Import dinamici (`await import()`) verso file già eliminati
- **Impatto**: Rischi di errori a runtime
- **Lezione**: Prima di eliminare un file, cercare **TUTTI i riferimenti** (statici E dinamici)
- **Prevenzione**: Usare `grep` per verificare ogni riferimento prima di eliminare

### 3. Dipendenze Python non verificate
- **Cosa**: Rischi di eliminare script Python necessari al workflow
- **Lezione**: Controllare sempre dipendenze e uso degli script prima di eliminarli

---

## ✅ PROBLEMI RISOLTI

| Problema | Stato | Note |
|----------|-------|------|
| BOM in `package.json` | ✅ Risolto | Rimosso BOM UTF-8 |
| Manca `app.listen()` | ✅ Risolto | Aggiunto in `addon.ts` |
| Errore manifest catalog | ✅ Risolto | Rimossa resource "catalog" |
| "Cannot GET /" | ✅ Risolto | Aggiunto route `/` con landing page |
| easyproxyDvr.ts orfano | ✅ Risolto | File eliminato SF19d |
| Import non-anime residui | ✅ Risolto | Rimossi SF1-SF4 |

---

## 📋 REGOLE DI PREVENZIONE

| # | Regola | Motivazione |
|---|--------|-------------|
| 1 | **NO PowerShell** per file >100KB | Corruzione accidentale |
| 2 | **Backup prima** di operazioni bulk | Recupero possibile |
| 3 | **Verificare con grep** prima di eliminare | File possono essere referenziati |
| 4 | **Controllare import dinamici** (`await import()`) | Sfuggono alle ricerche semplici |
| 5 | **Verificare dipendenze Python** | Evitare di rompere workflow |
| 6 | **Usare editor tool** per modifiche precise | PowerShell troppo rischioso |

---

**HanX** — Impariamo dagli errori, non ripeterli.
