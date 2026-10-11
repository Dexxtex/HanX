# 📦 Migrazione node-fetch v2 → v3

> **Stato**: Da fare — passo successivo dopo ESM completato
> **Rischio**: Alto (breaking changes significativi)
> **Dipendenze**: Richiede ESM/NodeNext già completato (prerequisito)

---

## 🎯 Obiettivo

Aggiornare `node-fetch` da v2.6.x a v3.3.x, che è **ESM-only** e conforme allo standard WHATWG Fetch.

---

## 📋 Installazione

```bash
pnpm up node-fetch@^3.3.2
pnpm remove @types/node-fetch
```

> **Nota**: node-fetch v3 include i tipi TypeScript nativamente — `@types/node-fetch` **non è più necessario**.

---

## 🔴 Breaking Changes Critici

### 1. ESM Only

`node-fetch` v3 è un modulo ESM puro. **Non funziona con `require()`**.

```javascript
// ❌ NON funziona in CJS:
const fetch = require('node-fetch');

// ✅ Soluzione CJS (se mai servisse):
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
```

> **Nel nostro caso**: il progetto è già ESM completo, quindi l'import funziona direttamente.

### 2. Option `timeout` Rimossa

La proprietà `timeout` **non esiste più** in v3. Usare `AbortSignal` invece.

```typescript
// ❌ PRIMA (v2):
fetch(url, { timeout: 5000 });

// ✅ DOPO (v3):
import timeoutSignal from 'timeout-signal';  // pacchetto opzionale
fetch(url, { signal: timeoutSignal(5000) });

// Oppure con AbortController nativo:
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);
fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
```

**Azioni necessarie**:
- Cercare tutti i `{ timeout: ... }` nel codice sorgente
- Sostituire con `AbortSignal.timeout(ms)` (Node.js 17+) o `timeoutSignal`

### 3. `res.textConverted()` Rimosso

```typescript
// ❌ PRIMA (v2):
const text = await res.textConverted();

// ✅ DOPO (v3):
// Usare fetch-charset-detection se serve charset detection
import convertBody from 'fetch-charset-detection';
const buf = await res.arrayBuffer();
const text = convertBody(buf, res.headers);
```

### 4. JSON Parse Error → `SyntaxError` invece di `FetchError`

```typescript
// ❌ PRIMA (v2):
try {
  const json = await res.json();
} catch (err) {
  if (err instanceof FetchError) { ... }  // catturava anche parse error
}

// ✅ DOPO (v3):
try {
  const json = await res.json();
} catch (err) {
  if (err instanceof SyntaxError) { ... }  // parse error ora è SyntaxError
  if (err instanceof FetchError) { ... }  // solo errori di rete
}
```

### 5. `Response.statusText` Vuoto

Se il server non invia status text, ora rimane **vuoto** invece di avere un default derivato dallo status code.

```typescript
// ❌ PRIMA (v2):
response.statusText  // "OK", "Not Found", ecc.

// ✅ DOPO (v3):
response.statusText  // "" (vuoto) se il server non lo invia
```

### 6. `req.body` Non Può Più Essere una Stringa

```typescript
// ❌ PRIMA (v2):
fetch(url, { body: "hello" });  // funziona

// ✅ DOPO (v3):
fetch(url, { body: Buffer.from("hello") });  // usare stream/buffer
// O meglio:
fetch(url, { body: new TextEncoder().encode("hello") });
```

### 7. Stream Error Listener → `once` invece di `on`

```typescript
// ❌ PRIMA (v2):
res.body.on('error', handler);

// ✅ DOPO (v3):
res.body.once('error', handler);
```

---

## ✅ Enhancements (Miglioramenti)

| Feature | Descrizione |
|---------|-------------|
| **Data URI** | Supporto per `data:` URLs |
| **UTF-8 URLs** | Miglior handling con WHATWG URL API |
| **TypeScript nativo** | Nessun `@types/node-fetch` necessario |
| **Blob exportato** | `Blob` esportato dal pacchetto |
| **Stream pipeline** | Errori piped con `stream.pipeline` |

---

## 🔍 Piano di Ricerca nel Codice

### Step 1: Trovare tutti gli usi di `timeout`

```bash
grep -rn "timeout" src/ --include="*.ts" | grep -v "FETCH_TIMEOUT" | grep -v "TTL"
```

Cercare pattern come:
- `{ timeout: ` nelle chiamate fetch
- `.timeout =` su AbortController

### Step 2: Trovare usi di `res.textConverted()`

```bash
grep -rn "textConverted" src/
```

### Step 3: Trovare try/catch su `.json()`

```bash
grep -rn "res.json()\|response.json()" src/
```

Verificare se catturano `FetchError` — potrebbero aver bisogno di gestire `SyntaxError`.

### Step 4: Trovare `req.body` come stringa

```bash
grep -rn "body:" src/ | grep -v "body\." | grep -v "body["
```

### Step 5: Trovare `res.body.on(`

```bash
grep -rn "res\.body\.on\|response\.body\.on" src/
```

---

## 📝 Checklist di Migrazione

- [ ] `pnpm up node-fetch@^3.3.2`
- [ ] `pnpm remove @types/node-fetch` (se presente)
- [ ] Sostituire `{ timeout: ms }` con `AbortSignal.timeout(ms)` o `timeoutSignal(ms)`
- [ ] Rimuovere eventuali usi di `textConverted()`
- [ ] Aggiornare catch block per `SyntaxError` su `.json()`
- [ ] Verificare che `body` non sia passato come stringa
- [ ] Cambiare `res.body.on('error')` → `res.body.once('error')`
- [ ] `pnpm build` — verificare zero errori
- [ ] `pnpm test` — verificare zero test falliti
- [ ] Test Docker — `docker compose build && docker compose up`

---

## 🔗 Risorse

- **Upgrade Guide Ufficiale**: https://github.com/node-fetch/node-fetch/blob/main/docs/v3-UPGRADE-GUIDE.md
- **Repo node-fetch**: https://github.com/node-fetch/node-fetch
- **timeoutSignal (pacchetto consigliato)**: https://github.com/node-fetch/timeout-signal
- **fetch-charset-detection**: https://github.com/Richienb/fetch-charset-detection
- **Node.js AbortSignal.timeout**: https://nodejs.org/api/globals.html#abortsigntimeout

---

**HanX** — Il tuo addon anime per Stremio/NUVIO.
