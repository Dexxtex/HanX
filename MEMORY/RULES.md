# 📜 Regole di Sviluppo — HanX

> **Ultimo aggiornamento**: 10/10/2026

---

## 🚨 REGOLE FONDAMENTALI

1. **Chiedere sempre prima** di iniziare azioni significative
2. **Interrompere tutto** se l'utente rifiuta la proposta
3. **Leggere RULES.md** prima di ogni sessione di lavoro

---

## 🎯 OBIETTIVO PROGETTO

**HanX** è un addon Stremio/NUVIO **esclusivo per anime**:
- Provider: AnimeUnity, AnimeSaturn, AnimeWorld
- Codice non-anime: ✅ RIMOSSO
- Infrastruttura: ✅ MANTENUTA (proxy, cache, mapping)

---

## 📁 STRUTTURA DOCUMENTAZIONE

| File | Scopo |
|------|-------|
| `MEMORY/MEMORY/01_STRUTTURA_E_ARCHITETTURA.md` | Architettura e componenti |
| `MEMORY/MEMORY/02_PROVIDERS_ANIME.md` | Provider e utility |
| `MEMORY/MEMORY/03_OBIETTIVI_E_TODO.md` | Obiettivi, roadmap e stato lavoro |

---

## ⚠️ FILE DA NON MODIFICARE

| File/Campo | Stato | Note |
|------------|-------|------|
| `easyproxyDvr.ts` | ✅ RIMOSSO | DVR non usato da anime |
| **EasyProxy SERVIZIO** | ✅ MANTENERE | Unico proxy media |
| Normalizzazioni anime | ✅ MANTENERE | Non modificare |
| `easyProxyUrl/Psw` | ✅ MANTENERE | Infrastruttura proxy |
| `tmdbApiKey` | ✅ MANTENERE | Metadati anime |
| `personalTmdbKey` | ✅ MANTENERE | UI helper (landingPage) |
| `easyProxyMaster` | ✅ MANTENERE | UI helper (landingPage) |

---

## 🔄 ORDINE MODIFICHE

Quando si modifica il codice, seguire questo ordine:

1. **landingPage.ts** — Interfaccia web
2. **extractor.ts** — Estrazione stream
3. **addon.ts** — Main addon (ultimo)
4. **Test compilazione** — `pnpm run build`

---

## ✅ AGGIORNAMENTO DOCUMENTAZIONE

- **AD OGNI SESSIONE**: aggiornare `MEMORY/MEMORY/03_OBIETTIVI_E_TODO.md`
- **NO file superflui**: non creare directory o file non necessari
- **Rimuovere**: riferimenti obsoleti, codice non-anime, import eliminati

---

**HanX** — Addon Stremio/NUVIO esclusivo per anime.
