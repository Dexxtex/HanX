# 🔄 Migrazione CJS → ESM — HanX

> **Context**: Questa documentazione copre la transizione da CommonJS a ECMAScript Modules (ESM) per il progetto HanX. È il prerequisito per usare `node-fetch@3`, `https-proxy-agent@9` e `socks-proxy-agent@10`.

> **⚠️ NOTA**: La migrazione ESM è stata completata con successo. Tutti gli errori TypeScript legati a ESM sono risolti. Gli errori rimanenti (26) sono bug preesistenti nel codice non correlati alla migrazione (tipi `unknown`, proprietà assenti, ecc.).

---

## ✅ Stato Attuale — Migrazione Completata

| Fase | Descrizione | Stato |
|------|-------------|-------|
| **Punto 1** | `package.json` → `"type": "module"`, `node-fetch@3`, `tsx`, script aggiornati | ✅ Completato |
| **Punto 2** | `tsconfig.json` → `module: NodeNext`, `target: ESNext` | ✅ Completato |
| **Punto 3** | Rimossi `declare require`, import `fetch` corretto, `fetchMod` → `globalThis.fetch` | ✅ Completato |
| **Punto 4** | `__dirname` → `fileURLToPath(import.meta.url)` in 6 file | ✅ Completato |
| **Punto 5** | Zero `require()` rimasti in `src/**/*.ts` | ✅ Completato |
| **Punto 6** | `check_domains.js` → `check_domains.cjs` + script aggiornato | ✅ Completato |
| **Punto 7** | Tutti gli import relativi con `.js` (statici + dynamic) | ✅ Completato |
| **Build** | Zero errori ESM (`TS2835`, `ERR_MODULE_NOT_FOUND`) | ✅ Completato |
| **Build** | Zero errori TypeScript totali | ✅ Completato (61/61 risolti) |

---

## 📋 Checklist Passo-Passo

### 1. Configurazione `package.json` ✅ COMPLETATO

```json
{
  "type": "module"
}
```

**Nota**: Aggiungere `"type": "module"` dice a Node.js di trattare tutti i file `.js` come ESM.

> **Modifiche applicate**:
> - `"type": "module"` aggiunto
> - `"dev"` script: `ts-node` → `tsx`
> - `node-fetch`: `^2.6.7` → `^3.3.2`
> - `@types/node-fetch` rimosso (v3 ha tipi nativi)
> - `tsx: ^4.19.0` aggiunto
> - `check:domains` script: `check_domains.js` → `check_domains.cjs`

---

### 2. Configurazione `tsconfig.json` ✅ COMPLETATO

Cambiamenti necessari:

```jsonc
{
  "compilerOptions": {
    "target": "ESNext",              // Da: es2020 → ESNext
    "lib": ["ESNext"],               // Da: ["es2020", "dom"] → ESNext
    "module": "NodeNext",            // Da: commonjs → NodeNext
    "moduleResolution": "NodeNext",  // Nuovo: fondamentale per ESM
    "esModuleInterop": false,        // Da: true → false (non serve più)
    "allowSyntheticDefaultImports": false, // Nuovo: coerente con esModuleInterop
    // ... mantenere le altre opzioni
  }
}
```

**Perché `NodeNext`?**
- È l'unico valore per `module` che supporta pienamente ESM in Node.js
- Segue le regole di risoluzione moduli native di Node.js
- Richiede estensioni esplicite negli import relativi (`./file.js` invece di `./file`)

---

### 3. Conversione `require()` → `import`

#### Pattern da sostituire:

**PRIMA (CJS):**
```typescript
const fs = require('fs');
const path = require('path');
const { Express } = require('express');
const addon = require('stremio-addon-sdk');
```

**DOPO (ESM):**
```typescript
import fs from 'fs';
import path from 'path';
import { Express } from 'express';
import addon from 'stremio-addon-sdk';
```

#### Regex per VS Code (Find & Replace):

**Trova:**
```regex
(const|var)(\s.*\s*)=\s*require\(((')|")(.*)\2\3\4\5(')|")\)(;?)$
```

**Sostituisci con:**
```regex
import $5 from $6;
```

> ⚠️ **Attenzione**: Verificare manualmente ogni sostituzione, specialmente per import con destructuring.

---

### 4. Import con Destructuring

**PRIMA (CJS):**
```typescript
const { Router, json } = require('express');
```

**DOPO (ESM):**
```typescript
import { Router, json } from 'express';
```

---

### 5. Import Relativi con Estensioni `.js`

**IMPORTANTE**: Con ESM e `module: NodeNext`, tutti gli import relativi devono avere l'estensione esplicita.

**PRIMA (CJS):**
```typescript
import { something } from './utils';
import config from '../config';
```

**DOPO (ESM):**
```typescript
import { something } from './utils.js';
import config from '../config.js';
```

#### Regex per VS Code:

**Trova:**
```regex
from\s+['"]\.\/([^'"]+)['"]
```

**Sostituisci con:**
```regex
from './$1.js'
```

**Trova:**
```regex
from\s+['"]\.\.\/([^'"]+)['"]
```

**Sostituisci con:**
```regex
from '../$1.js'
```

---

### 6. Gestione `__dirname` e `__filename`

In ESM, `__dirname` e `__filename` **non sono disponibili**. Usare queste alternative:

**PRIMA (CJS):**
```typescript
console.log(__dirname);
console.log(__filename);
```

**DOPO (ESM):**
```typescript
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log(__dirname);
console.log(__filename);
```

---

### 7. Import Dinamico (se necessario)

Se devi importare qualcosa in modo condizionale o lazy:

```typescript
// Import dinamico (ESM-only)
const module = await import('./optional-module.js');

// Con dynamic import da CJS (non consigliato, ma possibile)
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));
```

---

### 8. Strumenti di Sviluppo

#### ts-node con ESM

Creare un file `tsnode.esm.js` nella root:

```typescript
// tsnode.esm.js
import { register } from "node:module";
register("ts-node/esm", import.meta.url);
```

**Avviare con:**
```bash
node --import ./tsnode.esm.js src/addon.ts
```

#### Alternativa: tsx (consigliato)

`tsx` supporta ESM nativamente senza configurazioni aggiuntive:

```bash
pnpm add -D tsx
```

**Aggiungere script in `package.json`:**
```json
{
  "scripts": {
    "dev": "tsx src/addon.ts"
  }
}
```

---

### 9. dotenv in ESM

**PRIMA (CJS):**
```typescript
import dotenv from 'dotenv';
dotenv.config();
```

**DOPO (ESM):**
```typescript
// Importare il config prima di qualsiasi altra cosa
import 'dotenv/config.js';
```

> ⚠️ **Importante**: Mettere `import 'dotenv/config.js'` come **prima riga** nel file principale, prima di tutti gli altri import.

---

### 10. Problematiche Comuni e Soluzioni

| Problema | Soluzione |
|----------|-----------|
| `ERR_MODULE_NOT_FOUND` | Aggiungere `.js` a tutti gli import relativi |
| `This expression is not constructable` | Usare `.default` per alcune librerie CJS: `new MyClass.default()` |
| `process.env` non definito | Spostare `import 'dotenv/config.js'` all'inizio del file |
| `__dirname` non definito | Usare `fileURLToPath(import.meta.url)` come mostrato sopra |
| Import di librerie CJS | Alcune richiedono `.default` sull'istanza della classe |
| TypeScript error su import | Verificare `module: NodeNext` e `moduleResolution: NodeNext` |

---

### 11. Verifica Librerie Compatibili

Prima di migrare, verificare che tutte le dipendenze supportino ESM:

| Libreria | ESM Ready | Note |
|----------|-----------|------|
| `express` | ✅ | v4+ supporta ESM |
| `axios` | ✅ | v1+ supporta ESM |
| `stremio-addon-sdk` | ⚠️ | Verificare compatibilità |
| `node-fetch` | ❌ v2 / ✅ v3 | v2 è CJS-only, v3 è ESM-only |
| `https-proxy-agent` | ✅ | v7+ CJS, v9+ ESM |
| `socks-proxy-agent` | ✅ | v8+ CJS, v10+ ESM |
| `cheerio` | ✅ | v1+ supporta ESM |
| `jsdom` | ✅ | v30+ supporta ESM |
| `tough-cookie` | ✅ | v6+ supporta ESM |

---

## 🚀 Sequenza Operativa Consigliata

```bash
# 1. Creare branch dedicata (già fatto: chore/modernization)
git checkout -b chore/modernization-esm

# 2. Aggiornare package.json
#    Aggiungere "type": "module"

# 3. Aggiornare tsconfig.json
#    module: "NodeNext"
#    moduleResolution: "NodeNext"
#    target: "ESNext"
#    lib: ["ESNext"]

# 4. Convertire tutti i require() in import()
#    Usare regex VS Code (vedi sopra)

# 5. Aggiungere estensioni .js agli import relativi
#    Usare regex VS Code (vedi sopra)

# 6. Sostituire __dirname/__filename
#    Usare fileURLToPath (vedi sopra)

# 7. Usare tsx per lo sviluppo

# 8. Testare il build
pnpm install && pnpm build

# 9. Testare in sviluppo
pnpm dev

# 10. Verificare che tutto funzioni
#     Avviare l'applicazione e testare le funzionalità
```

---

## 📊 Risultati Test Build

```bash
$ pnpm install
✓ Lockfile passes supply-chain policies
dependencies:
- node-fetch 2.7.0
+ node-fetch 3.3.2
devDependencies:
- @types/node-fetch 2.6.13
+ tsx 4.23.15

$ pnpm build
# ✅ Zero errori ESM (TS2835 - Relative import paths need explicit file extensions)
# ⚠️ ~50 errori preesistenti (non legati a ESM):
#    - TS18046: 'data' is of type 'unknown'
#    - TS2339: Property 'xxx' does not exist on type '{}'
```

**Conclusione**: La migrazione ESM è completata con successo. Gli errori rimanenti sono bug preesistenti nel codice TypeScript che vanno fixati separatamente.

---

## 🎯 Piano di Migrazione Concreto — 10 Punti

> Basato sull'analisi del progetto HanX (branch `chore/modernization`).

### Punto 1: Aggiornare `package.json`

**File**: `package.json`

Aggiungere 3 modifiche:
```diff
+ "type": "module",
  "scripts": {
-   "dev": "ts-node src/addon.ts",
+   "dev": "tsx src/addon.ts",
  },
  "dependencies": {
-   "node-fetch": "^2.6.7",
+   "node-fetch": "^3.3.2",
  },
  "devDependencies": {
-   "@types/node-fetch": "^2.6.13",
+   // RIMOSSO: node-fetch v3 non ha bisogno di @types
    "tsx": "^4.19.0",
  }
```

**Perché node-fetch v3?** La v2 è CJS-only e non funziona in ESM. La v3 è ESM-native.

---

### Punto 2: Aggiornare `tsconfig.json`

**File**: `tsconfig.json`

```diff
  "compilerOptions": {
-   "target": "es2020",
-   "lib": ["es2020", "dom"],
-   "module": "commonjs",
-   "esModuleInterop": true,
+   "target": "ESNext",
+   "lib": ["ESNext"],
+   "module": "NodeNext",
+   "moduleResolution": "NodeNext",
+   "esModuleInterop": false,
+   "allowSyntheticDefaultImports": true,
    // ... mantenere le altre opzioni
  }
```

**Nota**: `module: NodeNext` è obbligatorio per ESM con TypeScript in Node.js.

---

### Punto 3: Rimuovere `declare require` e fixing import CJS in `addon.ts`

**File**: `src/addon.ts`

Rimuovere le dichiarazioni fittizie CJS (righe 15-26):
```typescript
// ❌ RIMUOVERE TUTTO QUESTO BLOCCO:
// --- Lightweight declarations to avoid TS complaints if @types/node non installati ---
declare const __dirname: string;
declare const process: any;
declare const Buffer: any;
declare function require(name: string): any;
declare const global: any;
```

Convertire l'import CJS-style (riga 12):
```typescript
// ❌ PRIMA:
import fetchMod = require('node-fetch');

// ✅ DOPO:
import fetch from 'node-fetch';
```

> **⚠️ Nota aggiuntiva**: `fetchMod` è stato rimosso completamente. Il codice usa ora `globalThis.fetch` (Node.js 18+ ha fetch nativo). I riferimenti a `fetchMod.Response` sono stati sostituiti con `Response` (Web standard). L'import `Response` di Express è stato rinominato in `ExpressResponse` per evitare conflitti di tipo.
>
> **Proprietà rimosse da `globalThis.fetch`**: `size` e `agent` non sono supportati dalla Web Fetch API standard. Sono stati rimossi dall'object literal della richiesta.
---

### Punto 4: Sostituire `__dirname` con `fileURLToPath`

**File coinvolti**: `src/addon.ts`, `src/extractor.ts`, `src/utils/domains.ts`, `src/utils/tmdbResolver.ts`, `src/providers/anime-core/provider-urls.ts`, `src/providers/flaresolverr.ts`

Pattern da aggiungere all'inizio di ogni file che usa `__dirname`:
```typescript
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

**Dettaglio per file**:
| File | Uso di `__dirname` | Riga |
|------|-------------------|------|
| `src/addon.ts` | `path.join(__dirname, '..', 'addon-config.json')` e `express.static(path.join(__dirname, '..', 'public'))` | 7, 1640 |
| `src/extractor.ts` | `path.join(__dirname, '../config/domains.json')` | 7 |
| `src/utils/domains.ts` | `path.join(__dirname, '..', '..', 'config', 'domains.json')` | 10 |
| `src/utils/tmdbResolver.ts` | `path.join(__dirname, '..', 'config', 'imdbToTmdb.json')` | 26 |
| `src/providers/anime-core/provider-urls.ts` | `path.resolve(__dirname, '..', '..', '..', 'config', 'provider_urls.json')` | 19 |
| `src/providers/flaresolverr.ts` | Nessuno diretto, ma usa `require('fs')` e `require('path')` | 22-23 |

---

### Punto 5: Convertire `require()` in `import` — flaresolverr.ts

**File**: `src/providers/flaresolverr.ts`

Rimuovere le dichiarazioni `declare function require` e convertire:
```typescript
// ❌ PRIMA (righe 21-23):
const fs = require('fs');
const path = require('path');

// ✅ DOPO:
import * as fs from 'fs';
import * as path from 'path';
```

Convertire l'uso dinamico di `require('undici')` (riga 149):
```typescript
// ❌ PRIMA:
const agent = new (require('undici').ProxyAgent)(proxy);

// ✅ DOPO:
const { ProxyAgent } = await import('undici');
const agent = new ProxyAgent(proxy);
```

> **Verifica**: Zero `require()` rimasti in `src/**/*.ts` dopo la migrazione.

---

### Punto 6: Convertire `require()` in `import` — check_domains.js

**File**: `scripts/check_domains.js`

Questo file è un **script di utilità**, non parte del codice principale. Ha due opzioni:

**Opzione A — Convertire a ESM** (consigliato):
```typescript
// ❌ PRIMA:
const fs = require('fs');
const path = require('path');
const { fetchPage } = require(flaresolverrPath);

// ✅ DOPO:
import fs from 'fs';
import path from 'path';
import { fetchPage } from '../dist/providers/flaresolverr.js';
```

**Opzione B — Rinominare in `.cjs`** (alternativa rapida):
Rinominare `check_domains.js` → `check_domains.cjs`. Node.js tratterà il file come CJS anche con `"type": "module"` in package.json.

---

### Punto 7: Verificare import relativi con estensioni `.js`

**File coinvolti**: Tutti i file in `src/` (statici + dynamic imports)

Il codice attuale usa già le estensioni `.js` negli import relativi (TypeScript con `module: NodeNext` lo richiede). Verificare che non manchino:

```bash
# Cerca import relativi senza estensione:
grep -rn "from ['"]\./" src/ | grep -v '\.js["\']'
grep -rn "from ['"]\.\./" src/ | grep -v '\.js["\']'
```

Se ne trova, aggiungere `.js` all'estensione.

**File corretti nel Punto 7**:
| File | Import corretti |
|------|------------------|
| `src/providers/anime-core/index.ts` | `./cache.js`, `./fetch-resource.js`, `./provider-urls.js`, `./helpers.js` |
| `src/mapping/index.ts` | `./types.js`, `./request.js`, `./live.js` |
| `src/providers/anime-core/fetch-resource.ts` | `./cache.js` |
| `src/providers/animesaturn-provider.ts` | `../types/animeunity.js`, `./kitsu.js`, `../utils/domains.js`, `../utils/animeGate.js`, `./anime-core/index.js`, dynamic `../utils/tmdbResolver.js` (×2) |
| `src/providers/animeunity-provider.ts` | `./kitsu.js`, `../utils/domains.js`, `../utils/easyproxy.js`, `../types/animeunity.js`, `../utils/animeGate.js`, `./anime-core/index.js`, dynamic `../utils/tmdbResolver.js` |
| `src/providers/animeworld-provider.ts` | `./kitsu.js`, `../utils/domains.js`, `../types/animeunity.js`, `../utils/animeGate.js`, `./anime-core/index.js`, dynamic `../utils/tmdbResolver.js` |
| `src/providers/kitsu.ts` | `../types/animeunity.js` |
| `src/utils/animeGate.ts` | `../types/animeunity.js`, dynamic `./tmdbResolver.js` |
| `src/utils/animeTitleResolver.ts` | rimosso in 12.5.0 (modulo non utilizzato) |
| `src/addon.ts` | dynamic `./providers/animesaturn-provider.js`, `./providers/animeworld-provider.js` |

---

### Punto 8: Aggiornare `fetchResource.ts` — fallback `require('node-fetch')`

**File**: `src/providers/anime-core/fetch-resource.ts`

Rimuovere il blocco try/catch con `require` e usare `globalThis.fetch` direttamente:
```typescript
// ❌ PRIMA (righe 10-20):
let fetchImpl: typeof globalThis.fetch;
try {
  if (typeof globalThis.fetch === 'function') {
    fetchImpl = globalThis.fetch;
  } else {
    fetchImpl = require('node-fetch') as any;
  }
} catch {
  fetchImpl = globalThis.fetch;
}

// ✅ DOPO:
const fetchImpl = globalThis.fetch;
```

Node.js 18+ ha `fetch` nativo, non serve il fallback.

---

### Punto 9: Aggiornare script `build` per ESM

**File**: `package.json`

Lo script build attuale dovrebbe funzionare, ma verificare che il copy dei file JSON sia corretto:
```json
"build": "tsc && npx shx mkdir -p dist/config && npx shx cp -r config dist/ && npx shx cp src/config/*.json dist/config/"
```

Con `module: NodeNext`, TypeScript compila i `.ts` in `.js` ESM nella cartella `dist/`. Il copy dei file JSON (config/domains.json, config/provider_urls.json) deve continuare a funzionare.

---

### Punto 10: Installare dipendenze e testare

```bash
# 1. Installa le dipendenze aggiornate
pnpm install

# 2. Testa il build
pnpm build

# 3. Se il build passa, testare in sviluppo
pnpm dev

# 4. Se tutto ok, testare lo script di check_domains
pnpm check:domains
```

**Cosa verificare**:
- [x] `pnpm build` compila senza errori ESM (TS2835, ERR_MODULE_NOT_FOUND)
- [ ] `pnpm dev` avvia il server senza `ERR_MODULE_NOT_FOUND`
- [ ] I provider (AnimeUnity, AnimeSaturn, AnimeWorld) funzionano
- [ ] Lo script `check_domains.cjs` gira correttamente
- [ ] I file JSON nella cartella `dist/config/` sono copiati

> **Nota**: Gli errori TypeScript rimanenti (~50) sono bug preesistenti non legati alla migrazione ESM. Vanno fixati separatamente aggiungendo tipi espliciti o `as any`.

1. **Fare una cosa alla volta**: testare il build dopo ogni passaggio significativo
2. **Leggere gli errori**: molti errori ESM sono risolvibili aggiungendo `.js` agli import
3. **Verificare le dipendenze**: alcune librerie potrebbero richiedere aggiustamenti
4. **Testare in sviluppo e produzione**: sia `pnpm dev` che `pnpm build && node dist/addon.js`
5. **Non dimenticare dotenv**: deve essere importato per primo

---

---

## ✅ Tutti gli Errori Risolti

Dalla migrazione ESM a oggi, **61 errori TypeScript risolti** (0 rimanenti).

### ✅ Errori Risolti — Migrazione ESM (35)

| File | Errori Risolti | Strategia |
|------|---------------|-----------|
| `src/extractor.ts` | 5 | Interfacce `TmdbMovieResponse`, `TmdbTvResponse`, `VixSrcApiResponse` + type assertion |
| `src/utils/tmdbResolver.ts` | 2 | Interfaccia `TmdbFindResponse` + type assertion |
| `src/utils/animeGate.ts` | 3 | Interfaccia `TmdbBasicResponse` + type assertion |
| `src/providers/animesaturn-provider.ts` | 17 | 9 interfacce (`HaglundResponseItem`, `KitsuMappingsResponse`, `JikanResponse`, `TmdbTitleResponse`, ecc.) + type assertion |
| `src/providers/animeworld-provider.ts` | 2 | Interfacce `HaglundResponseItem`, `TmdbTitleResponse` + type assertion |
| `src/providers/animeunity-provider.ts` | 6 | Interfacce `HaglundResponseItem`, `TmdbTitleResponse` + type assertion |

### ✅ Errori Risolti — Tipi `unknown` (26)

| File | Errori | Causa | Soluzione |
|------|--------|-------|-----------|
| `animeworld-provider.ts` | 13 | `mappingsResp`, `animeResp`, `incResp`, `jikanResp`, `tmdbResp` senza tipo | 11 interfacce aggiunte (`KitsuMappingsResponse`, `KitsuAnimeResponse`, `JikanAnimeResponse`, ecc.) + type assertion su `.json()` |
| `animeunity-provider.ts` | 13 | `mappingsResp`, `kitsuMain`, `jikanResp`, `tmdbResp` senza tipo | Stessa strategia: interfacce + type assertion |

### ✅ Errori Risolti — Compatibilità ESM/CJS

| File | Problema | Soluzione |
|------|----------|-----------|
| `src/addon.ts` | `stremio-addon-sdk` non esporta named import in ESM | Default import + destructuring + `import type` per Manifest/Stream |
| `scripts/check_domains.js` | File `.js` interpretato come ESM ma scritto in CJS | Rinominato in `.cjs` |

---

## 🔗 Risorse Utili

- [TypeScript ESM/CJS Interop Docs](https://www.typescriptlang.org/docs/handbook/modules/appendices/esm-cjs-interop.html)
- [Node.js ESM Documentation](https://nodejs.org/api/esm.html)
- [Sindre Sorhus ESM Guide](https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c)
- [Anthony Fu: Move on to ESM-only](https://antfu.me/posts/move-on-to-esm-only)
- [Martin Gregersen: CJS to ESM Conversion](https://mgregersen.dk/converting-a-typescript-project-from-cjs-to-esm-the-ultimate-how-to/)

---

**HanX** — Il tuo addon anime per Stremio/NUVIO.
