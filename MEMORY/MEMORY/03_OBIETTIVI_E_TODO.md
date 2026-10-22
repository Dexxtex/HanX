# 🎯 OBIETTIVI E STATO LAVORO — HanX

## ✅ Migrazione metadata MAL da Jikan a Tenrai + cache SQLite (2026-10-12)

- Tutti i riferimenti runtime a `api.jikan.moe` rimossi; i tre provider condividono il resolver Tenrai.
- Metadata MAL persistiti in SQLite tramite `node:sqlite`; cache positiva con ETag/`If-None-Match`, update su `200`, conferma su `304`, negative cache su `404` e stale-on-error.
- Single-flight per ID, rate limiter persistente in SQLite (default 3 RPS / 100 RPM), gestione `Retry-After` e backoff.
- Configurazione in `.env` / `.env.example`; Docker Compose carica `.env` e conserva il DB nel volume `hanx-data`.
- Verifica: `pnpm test` (6/6); image Docker/Compose costruita; `mal:1` in container ha restituito 2 stream AnimeWorld. La cache ETag e il limiter persistono al riavvio del container.


## 🚀 ROADMAP MODERNIZZAZIONE (Fase futura)

> **Nota**: Questa è una roadmap di migrazione maggiore, non immediata. Ogni fase va fatta in branch separata.

### 📋 Panoramica Migrazioni

| # | Migrazione | Stato | Rischio |
|---|-----------|-------|---------|  
| 1 | tough-cookie 4 → 6 | ✅ Completato | Medio |
| 2 | jsdom 26 → 30 | ✅ Completato | Medio |
| 3 | ESM/NodeNext | ✅ Completato | Alto |
| 4 | Proxy agent 7/8 → 9/10 | ✅ Completato (2026-10-11) | Medio |
| 5 | node-fetch 2 → 3 | ✅ Completato (2026-10-11) | Alto — nessuna modifica codice necessaria |
| 6 | express 4 → 5 + @types/express 5 | ✅ Completato (2026-10-11) | Alto — vedi 05_EXPRESS_V5_MIGRATION.md |
| 7 | Node 24 → 26 + @types/node 26 | ✅ Completato (2026-10-11) | Basso/medio |
| 8 | TypeScript 5.9 → 7 | ⬜ Da fare (toolchain non pronta) | Medio/alto |
| 9 | Sicurezza — shx + overrides | ✅ Completato (2026-10-11) | Basso — vedi 06_SECURITY_MIGRATION.md |

### 🔑 Prerequisito: ESM o Dual-Mode

È il prerequisite per node-fetch@3 (✅ completato), https-proxy-agent@9 e probabilmente semplifica anche socks-proxy-agent@10.

> 📖 **Documentazione completa**: Vedi `MEMORY/MIGRATION/01_MIGRAZIONE_ESM.md` per guide passo-passo, regex, e soluzioni ai problemi comuni.

**Opzione A — Migrazione completa a ESM**:
- `"type": "module"` in package.json
- `import` al posto di `require()`
- Estensioni esplicite negli import relativi
- `"module": "NodeNext"` in tsconfig.json

**Opzione B — Compatibilità minima (consigliata per transizione)**:
- Mantieni CJS
- Usa dynamic import solo dove serve:
```ts
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));
```

> **node-fetch@3 è ufficialmente ESM-only** e non supporta `require()`. Se resti su CJS, resta su v2 oppure usa `import()` dinamico.

### 📦 Sequenza Operativa Consigliata

```bash
# 1. Branch dedicata
git checkout -b chore/modernization

# 2. Cookie/jsdom (minimo rischio)
pnpm up tough-cookie@^6.0.2 jsdom@^30.1.2
pnpm test && pnpm build

# 3. ESM/NodeNext (prerequisito per i seguenti)
# modifica tsconfig.json + package.json
pnpm build && docker compose build && docker compose up -d

# 4. node-fetch (dopo ESM) ✅ COMPLETATO 2026-10-11
# node-fetch@^3.3.2 installato — nessun codice da modificare
# Il progetto usa già globalThis.fetch (Node.js 18+ native)
pnpm test

# 5. Proxy agent (dopo ESM) ✅ COMPLETATO 2026-10-11
# https-proxy-agent@^9.1.0 + socks-proxy-agent@^10.1.0 installati
# Build OK, test OK, proxy funzionali verificati

# 6. Express 5 (dopo proxy agent) ✅ COMPLETATO 2026-10-11
# Vedi MEMORY/MIGRATION/05_EXPRESS_V5_MIGRATION.md per piano completo
# express@^5.3.0 + @types/express@^5.0.6 installati
# Codemod applicato: dotfiles: 'allow' su express.static()
# Build OK, test OK, server Express 5 attivo

# 7. Node 26 + @types/node 26 ✅ COMPLETATO 2026-10-11
# Dockerfile: FROM node:26-slim
# @types/node@^26.6.4 installato
# Build OK, test OK
```

### ⚠️ Express 4 → 5: Breaking Changes Critici

```bash
# Cerca usi obsoleti:
rg -n "app\.del\(|res\.sendfile\(|acceptsCharset\(|acceptsEncoding\(|acceptsLanguage\(" src
rg -n "app\.(get|use|all)\(['\"][^'\"]*\*" src
```

**Cambiamenti sintassi**:
- `app.del()` → `app.delete()`
- `res.sendfile()` → `res.sendFile()`
- `req.acceptsCharset()` → `req.acceptsCharsets()`
- `req.acceptsEncoding()` → `req.acceptsEncodings()`
- `req.acceptsLanguage()` → `req.acceptsLanguages()`
- `res.send(status)` e `res.json(obj, status)` → **non più supportati**
- Wildcard `*` → spesso serve `/*` splat
- Async middleware → le promise rejectate arrivano davvero agli error handler

### 🍪 tough-cookie + jsdom

- **tough-cookie@6.0.2**: ✅ testato, build OK, `@types/tough-cookie` rimosso (tipi integrati)
- **jsdom@30.1.2**: ✅ testato, build OK

### 🔄 ESM/NodeNext

- **Stato**: ✅ Completato — conversione da CJS a ESM terminata, build e Docker funzionanti
- **File guida**: `MEMORY/MIGRATION/01_MIGRAZIONE_ESM.md`
- **Cambiamenti completati**:
  - [x] Aggiungere `"type": "module"` in `package.json`
  - [x] Aggiornare `tsconfig.json`: `module: "NodeNext"`, `moduleResolution: "NodeNext"`
  - [x] Convertire tutti i `require()` in `import`
  - [x] Aggiungere estensioni `.js` agli import relativi
  - [x] Sostituire `__dirname`/`__filename` con `fileURLToPath(import.meta.url)`
  - [x] Usare `tsx` per lo sviluppo
  - [x] Importare `dotenv/config.js` come prima riga
  - [x] Testare build e avvio
- **Casi limite CJS risolti**: `stremio-addon-sdk` (default import + `import type` per Manifest/Stream), `check_domains.js` → `.cjs`

### 🐳 Node 26 + Docker

```dockerfile
# Dockerfile
FROM node:26-slim
```

### 🎯 Nota

- ✅ **`shx` rimosso** — `braces` CVE-2026-93687 eliminato
- ⚠️ **Vulnerabilità residue** — `path-to-regexp` + `tmp` in `stremio-addon-sdk` (rischio basso accettato, dipendenze CLI non esposte)
- 📝 **Dettagli**: Vedi `MEMORY/MIGRATION/06_SECURITY_MIGRATION.md`
- **Fai una branch per fase**, non un unico mega-PR
- La combinazione ESM + node-fetch + Express 5 insieme renderebbe difficile isolare regressioni

### 🐌 TypeScript 7 — Posposto (toolchain non pronta)

> **Stato**: TypeScript 7.0 rilasciato il 8 luglio 2026 — **posposto per ora**
> **Motivo**: La JS API di TypeScript 7 non è stabile, strumenti come `typescript-eslint` e `ts-node` non sono compatibili

**Cosa cambia in TS 7:**
- Compiler riscritto in Go (10x più veloce)
- `tsc` command invariato, stesso type checking
- Nuovi default: `strict: true`, `target: es2025`, `module: esnext`, `types: []`
- Opzioni rimosse: `baseUrl`, `moduleResolution: node`, `target: es5`, `module: amd/umd/system`

**Strumenti NON compatibili con TS 7:**
| Tool | Status |
|------|--------|
| `typescript-eslint` | ❌ Dipende dalla JS API (non disponibile in TS 7) |
| `ts-node` | ❌ Crasha su startup |
| Vue/Svelte/Astro SFC | ❌ Template type checking |
| Angular template | ❌ Template type checking |

**Strumenti che FUNZIONANO:**
| Tool | Status |
|------|--------|
| `tsc` (build) | ✅ Compiler nativo Go |
| `tsx` | ✅ Funziona (non usa ts-node) |
| VS Code | ✅ Con estensione TS 7 |

**Soluzione di compatibilità (quando TS 7 sarà pronto):**
```json
{
  "devDependencies": {
    "@typescript/native": "npm:typescript@^7.0.2",
    "typescript": "npm:@typescript/typescript6@^6.0.2"
  }
}
```
- `npx tsc` → TypeScript 7 (build veloce)
- `npx tsc6` → TypeScript 6 (per typescript-eslint, ecc.)

**Quando procedere:**
- Dopo rilascio di `typescript-eslint` compatibile con TS 7
- Dopo che la JS API sarà stabilizzata (probabilmente TS 7.1+)
- Verificare: https://github.com/typescript-eslint/typescript-eslint/issues

---

## 📝 REGOLE CRITICHE

1. **EasyProxy FILE** (`easyproxyDvr.ts`): ✅ RIMOSSO (non usato)
2. **EasyProxy SERVIZIO**: ✅ MANTENUTO (unico proxy media)
3. **Normalizzazioni anime**: ✅ NON MODIFICARE
4. **Dipendenze proxy**: ✅ MANTENERE (`easyProxyUrl`, `easyProxyPassword`, `tmdbApiKey`)
5. **UI helper**: ✅ MANTENERE (`personalTmdbKey`, `easyProxyMaster`)
6. **Conteggio righe**: ✅ Usare sempre **editor**, mai terminale

---

**HanX** — Il tuo addon anime per Stremio/NUVIO.
