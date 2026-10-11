# 🎯 OBIETTIVI E STATO LAVORO — HanX


## 🚀 ROADMAP MODERNIZZAZIONE (Fase futura)

> **Nota**: Questa è una roadmap di migrazione maggiore, non immediata. Ogni fase va fatta in branch separata.

### 📋 Panoramica Migrazioni

| # | Migrazione | Stato | Rischio |
|---|-----------|-------|---------|  
| 1 | tough-cookie 4 → 6 | ✅ Completato | Medio |
| 2 | jsdom 26 → 30 | ✅ Completato | Medio |
| 3 | ESM/NodeNext | 🔴 In corso | Alto |
| 4 | Proxy agent 7/8 → 9/10 | ⬜ Da fare | Medio |
| 5 | node-fetch 2 → 3 | ⬜ Da fare | Alto |
| 6 | express 4 → 5 + @types/express 5 | ⬜ Da fare | Alto |
| 7 | Node 24 → 26 + @types/node 26 | ⬜ Da fare | Basso/medio |
| 8 | TypeScript 5.9 → 7 | ⬜ Da fare | Medio/alto |

### 🔑 Prerequisito: ESM o Dual-Mode

È il prerequisite per node-fetch@3, https-proxy-agent@9 e probabilmente semplifica anche socks-proxy-agent@10.

> 📖 **Documentazione completa**: Vedi `MEMORY/MEMORY/04_MIGRAZIONE_ESM.md` per guide passo-passo, regex, e soluzioni ai problemi comuni.

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

# 4. node-fetch (dopo ESM)
pnpm up node-fetch@^3.3.2
# Sostituisci: import fetch from 'node-fetch'
# Usa: AbortSignal.timeout(ms) al posto di timeout nelle opzioni
pnpm test

# 5. Proxy agent (dopo ESM)
pnpm up https-proxy-agent@^9.1.0 socks-proxy-agent@^10.1.0
# Testa: proxy HTTP, SOCKS, autenticazione, redirect, timeout
pnpm test

# 6. Express 5 (la più delicata)
pnpm up express@^5.3.0 @types/express@^5.0.6
# Controlla: app.del()→app.delete(), res.sendfile()→res.sendFile()
# Controlla: req.acceptsCharset()→req.acceptsCharsets()
# Controlla: wildcard routing (* → /*)
# Controlla: async middleware (ora le promise rejectate arrivano agli error handler)
pnpm test

# 7. Node 26 + @types/node 26 (ultimo)
# Dockerfile: FROM node:26-alpine
pnpm up @types/node@^26.6.5
docker compose build --no-cache && docker compose up -d
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

- **Stato**: 🔴 In corso — conversione da CJS a ESM
- **File guida**: `MEMORY/MEMORY/04_MIGRAZIONE_ESM.md`
- **Cambiamenti necessari**:
  - [ ] Aggiungere `"type": "module"` in `package.json`
  - [ ] Aggiornare `tsconfig.json`: `module: "NodeNext"`, `moduleResolution: "NodeNext"`
  - [ ] Convertire tutti i `require()` in `import`
  - [ ] Aggiungere estensioni `.js` agli import relativi
  - [ ] Sostituire `__dirname`/`__filename` con `fileURLToPath(import.meta.url)`
  - [ ] Configurare `tsnode.esm.js` o usare `tsx`
  - [ ] Importare `dotenv/config.js` come prima riga
  - [ ] Testare build e avvio

### 🐳 Node 26 + Docker

```dockerfile
# Dockerfile
FROM node:26-alpine  # o node:24-slim per ora
```

### 🎯 Cosa non aspettarsi

- Questi upgrade **NON risolvono le 6 vulnerabilità residue** (path-to-regexp, tmp, braces) — legate a `stremio-addon-sdk`
- Express 5 cambierà la catena di routing e **potrebbe** aggiornare `path-to-regexp`, quindi rivaluta l'audit dopo la migrazione
- **Fai una branch per fase**, non un unico mega-PR
- La combinazione ESM + node-fetch + Express 5 insieme renderebbe difficile isolare regressioni

### ✅ TypeScript 7 — Posporre

- TypeScript 7 è la nuova implementazione nativa
- **typescript-eslint** potrebbe non supportare ancora la API TS 7
- Aggiornare solo dopo aver verificato compatibilità con la toolchain

---

## 📝 REGOLE CRITICHE

1. **EasyProxy FILE** (`easyproxyDvr.ts`): ✅ RIMOSSO (non usato)
2. **EasyProxy SERVIZIO**: ✅ MANTENUTO (proxy alternativo)
3. **Normalizzazioni anime**: ✅ NON MODIFICARE
4. **Dipendenze proxy**: ✅ MANTENERE (`mediaFlowProxyUrl`, `mediaFlowProxyPassword`, `useMediaFlow`, `tmdbApiKey`)
5. **UI helper**: ✅ MANTENERE (`personalTmdbKey`, `mediaflowMaster`)
6. **Conteggio righe**: ✅ Usare sempre **editor**, mai terminale

---

**HanX** — Il tuo addon anime per Stremio/NUVIO.
