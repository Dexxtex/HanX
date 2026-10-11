# 🔄 Migrazione Express 4 → 5 + @types/express 5

> **Stato**: Da fare — passo dopo passo
> **Rischio**: Alto (dipende da `stremio-addon-sdk` che usa express 4)
> **Prerequisito**: ✅ ESM completato, ✅ proxy agent aggiornati

---

## 📋 Fonti Ufficiali

- **Guida ufficiale migration**: https://expressjs.com/en/guide/migrating-5/
- **Blog rilascio v5**: https://expressjs.com/en/blog/2024-10-15-v5-release/
- **Changelog GitHub**: https://github.com/expressjs/express/releases
- **Codemod ufficiali**: `npx codemod@latest @expressjs/v5-migration-recipe`
- **@types/express latest**: 5.0.6 (npm)

---

## 🎯 Obiettivo

Aggiornare Express da v4 a v5 e @types/express a v5:

| Pacchetto | Versione Attuale | Versione Target | Note |
|-----------|------------------|-----------------|------|
| `express` | 4.18.2 | **5.3.0** | Breaking changes minori |
| `@types/express` | 4.17.17 | **5.0.6** | Tipi allineati a v5 |

---

## 🔴 Breaking Changes — Riepilogo Ufficiale

### 1. Node.js ≥ 18 Richiesto

Express 5 richiede Node.js 18 o superiore.

> **Nel nostro caso**: Dockerfile usa `node:26-slim` ✅

### 2. Metodi Deprecati Rimosse

| Metodo v4 | Metodo v5 |
|-----------|-----------|
| `app.del()` | `app.delete()` |
| `res.sendfile()` | `res.sendFile()` |
| `res.send(status)` | `res.sendStatus(status)` |
| `res.send(body, status)` | `res.status(status).send(body)` |
| `res.json(obj, status)` | `res.status(status).json(obj)` |
| `res.redirect(url, status)` | `res.redirect(status, url)` |
| `req.acceptsCharset()` | `req.acceptsCharsets()` |
| `req.acceptsEncoding()` | `req.acceptsEncodings()` |
| `req.acceptsLanguage()` | `req.acceptsLanguages()` |
| `res.redirect('back')` | `res.redirect(req.get('Referrer') || '/')` |

### 3. Path Matching — path-to-regexp v7

- No più regex sub-expression: `/:foo(\d+)` non supportato
- Wildcard deve avere nome: `/*` → `/*splat`
- Optional params: `:name?` → `{name}`
- Caratteri riservati: `(`, `)`, `[`, `]`, `?`, `+`, `!`

### 4. Promise Support

I middleware/handler async che lanciano errori ora passano automaticamente all'error handler:

```typescript
// ✅ Ora funziona senza try/catch:
app.get('/user', async (req, res) => {
  const user = await getUser(req.params.id);
  res.send(user);
});
```

### 5. Body Parser Changes

- `express.urlencoded()` → `extended` di default a **false**
- `req.body` è `undefined` se il body non è parsato (prima era `{}`)

### 6. express.static dotfiles

- Default `dotfiles` → `"ignore"` (prima serviva tutto)
- File nascosti (es. `.well-known`) returnano 404 a meno che non si specifichi `dotfiles: 'allow'`

### 7. res.sendFile() / express.static() Options

- `hidden` → `dotfiles`
- `from` → `root`

### 8. req.params Null Prototype

- `req.params` ha **null prototype** con path stringa
- Wildcard params sono ora **array**
- Params non matchati sono **omessi** (non più `undefined`)

### 9. req.query non più Writable

- `req.query` è un getter, non più assegnabile

### 10. MIME Type Changes

- `.js` serve come `text/javascript` (prima `application/javascript`)

---

## ✅ Cosa NON Cambia

- API base: `app.get()`, `app.post()`, `app.use()`, `res.send()`, `res.json()`, ecc.
- Middleware pattern: `(req, res, next) => {}`
- Router: `express.Router()` funziona come prima
- Template engines: nessun cambiamento

---

## 🔍 Verifica Codice HanX

### Breaking Changes Trovati: **ZERO**

| Pattern | Trovato? | File |
|---------|----------|------|
| `app.del()` | ❌ No | — |
| `res.sendfile()` | ❌ No | — |
| `res.send(status, body)` | ❌ No | — |
| `res.json(obj, status)` | ❌ No | — |
| `req.acceptsCharset()` | ❌ No | — |
| `req.acceptsEncoding()` | ❌ No | — |
| `req.acceptsLanguage()` | ❌ No | — |
| `res.redirect('back')` | ❌ No | — |
| Wildcard `/*` senza nome | ❌ No | — |
| Regex path `/:foo(\d+)` | ❌ No | — |

### Come Express è Usato in HanX

| File | Pattern | Compatibile v5? |
|------|---------|-----------------|
| `src/addon.ts` | `express()` | ✅ |
| `src/addon.ts` | `app.get(['/vixsynthetic', ...], async ...)` | ✅ |
| `src/addon.ts` | `app.use('/public', express.static(...))` | ⚠️ Verificare dotfiles |
| `src/addon.ts` | `app.use((req, res, next) => ...)` sync | ✅ |
| `src/addon.ts` | `app.get('/', ...)` + `res.send(html)` | ✅ |

---

## ⚠️ Rischio: stremio-addon-sdk

`stremio-addon-sdk@^1.6.10` dipende da `express@4.x`.

**Opzioni:**
1. **Attendere** che `stremio-addon-sdk` aggiorni a Express 5
2. **Usare npm overrides** per forzare express 5 nelle transitive deps
3. **Forkare** `stremio-addon-sdk` e aggiornarlo internamente
4. **Testare** se l'addon funziona comunque con express 5 (potrebbe essere compatibile)

---

## 📝 Piano di Migrazione — 10 Fasi

| # | Fase | Descrizione | Rischio |
|---|------|-------------|---------|
| 1 | **Backup** | Snapshot package.json e pnpm-lock.yaml | Basso |
| 2 | **Installazione** | `pnpm up express@^5.3.0 @types/express@^5.0.6` | Medio |
| 3 | **Verifica Codemod** | Eseguire `npx codemod@latest @expressjs/v5-migration-recipe` | Basso |
| 4 | **Verifica express.static** | Controllare `dotfiles` per `/public` | Basso |
| 5 | **Verifica body-parser** | Controllare `urlencoded` extended option | Basso |
| 6 | **Verifica req.body** | Controllare usi di `req.body` quando body non parsato | Medio |
| 7 | **Verifica req.params** | Controllare wildcard e optional params | Basso |
| 8 | **Build & Type Check** | `pnpm build` — verificare zero errori | Medio |
| 9 | **Test Suite** | `pnpm test` — verificare zero test falliti | Alto |
| 10 | **Test Runtime** | Avviare addon e verificare risposta manifest | Alto |

---

## 📋 Checklist di Migrazione

- [ ] `pnpm up express@^5.3.0 @types/express@^5.0.6`
- [ ] Eseguire codemod: `npx codemod@latest @expressjs/v5-migration-recipe`
- [ ] Verificare `express.static('/public')` — aggiungere `dotfiles: 'allow'` se necessario
- [ ] Verificare `express.urlencoded()` — impostare `extended: true` se necessario
- [ ] Controllare usi di `req.body` senza body parser
- [ ] Controllare `req.params` per wildcard array
- [ ] `pnpm build` — zero errori TypeScript
- [ ] `pnpm test` — zero test falliti
- [ ] Testare addon in locale: `tsx src/addon.ts`
- [ ] Verificare manifest: `curl http://localhost:7000/streamio/v1/manifest.json`

---

## 📋 Piano di Esecuzione Dettagliato

### Fase 1 — Backup
```bash
cp package.json package.json.backup-express-v5
cp pnpm-lock.yaml pnpm-lock.yaml.backup-express-v5
pnpm list express @types/express
```

### Fase 2 — Installazione
```bash
pnpm up express@^5.3.0 @types/express@^5.0.6
```
Verificare:
- `package.json` → `"express": "^5.3.0"`
- `package.json` → `"@types/express": "^5.0.6"`
- `pnpm install` per aggiornare lockfile

### Fase 3 — Verifica Codemod
```bash
npx codemod@latest @expressjs/v5-migration-recipe
```
Il codemod ufficiale di Express applica automaticamente:
- `app.del()` → `app.delete()`
- `res.sendfile()` → `res.sendFile()`
- `res.send(status, body)` → `res.status(status).send(body)`
- `req.acceptsCharset()` → `req.acceptsCharsets()`
- ecc.

### Fase 4 — Verifica express.static
```typescript
// PRIMA (v4):
app.use('/public', express.static(path.join(__dirname, '..', 'public')));

// DOPO (v5) — se servono file nascosti:
app.use('/public', express.static(path.join(__dirname, '..', 'public'), {
  dotfiles: 'allow'
}));
```

### Fase 5 — Verifica body-parser
```typescript
// PRIMA (v4):
app.use(express.urlencoded()); // extended: true di default

// DOPO (v5):
app.use(express.urlencoded()); // extended: false di default
// OPPURE:
app.use(express.urlencoded({ extended: true }));
```

### Fase 6 — Verifica req.body
```typescript
// PRIMA (v4):
console.log(req.body); // => {}

// DOPO (v5):
console.log(req.body); // => undefined (se body non parsato)
```

### Fase 7 — Verifica req.params
```typescript
// PRIMA (v4):
app.get('/*', (req, res) => {
  req.params[0]; // => '' (empty string)
});

// DOPO (v5):
app.get('/*splat', (req, res) => {
  req.params.splat; // => [] (array) o omesso se vuoto
});
```

### Fase 8 — Build & Type Check
```bash
pnpm build
```

**Errori comuni:**
- `TS2339: Property 'del' does not exist` → usare `delete()`
- `TS2339: Property 'sendfile' does not exist` → usare `sendFile()`
- `TS2345: Argument of type 'number' is not assignable` → `res.send(status)` → `res.sendStatus(status)`

### Fase 9 — Test Suite
```bash
pnpm test
```

### Fase 10 — Test Runtime
```bash
tsx src/addon.ts
# Testare:
curl http://localhost:7000/streamio/v1/manifest.json
curl http://localhost:7000/streamio/v1/config/manifest.json
```

---

## 🔗 Risorse

- **Express 5 Migration Guide**: https://expressjs.com/en/guide/migrating-5/
- **Express 5 Release Blog**: https://expressjs.com/en/blog/2024-10-15-v5-release/
- **Express 5 Codemods**: https://codemod.link/express
- **path-to-regexp v7**: https://github.com/pillarjs/path-to-regexp
- **@types/express npm**: https://www.npmjs.com/package/@types/express

---

**HanX** — Il tuo addon anime per Stremio/NUVIO.
