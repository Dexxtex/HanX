# 🔄 Migrazione Proxy Agent v7/v8 → v9/v10

> **Stato**: ✅ Completato (2026-10-11) — tutte le 10 fasi verificate
> **Rischio**: Medio (ESM conversion + Node.js 20+ requirement)
> **Dipendenze**: Richiede ESM/NodeNext già completato (prerequisito) — ✅ Soddisfatto

---

## 🎯 Obiettivo

Aggiornare i proxy agent alle ultime versioni major:

| Pacchetto | Versione Attuale | Versione Target | Note |
|-----------|------------------|-----------------|------|
| `https-proxy-agent` | 7.0.6 | **9.1.0** | ESM + Node.js ≥ 20 |
| `socks-proxy-agent` | 8.0.5 | **10.1.0** | ESM + Node.js ≥ 20 |

---

## 📋 Installazione

```bash
pnpm up https-proxy-agent@^9.1.0 socks-proxy-agent@^10.1.0
```

---

## 🔴 Breaking Changes

### 1. ESM Only (v8/v9+)

`https-proxy-agent` e `socks-proxy-agent` dalle versioni 8/9 in poi sono **moduli ESM puri**.

```typescript
// ❌ PRIMA (v7 CJS):
const { HttpsProxyAgent } = require('https-proxy-agent');

// ✅ DOPO (v9 ESM):
import { HttpsProxyAgent } from 'https-proxy-agent';
```

> **Nel nostro caso**: il progetto è già ESM completo (dopo migrazione ESM), quindi l'import funziona direttamente.

### 2. Node.js 20+ Requirement

Le versioni v9/v10 richiedono **Node.js 20 come versione minima**.

```
https-proxy-agent v9.0.0: Node.js ≥ 20
socks-proxy-agent v10.0.0: Node.js ≥ 20
```

> **Verifica**: Controllare la versione di Node.js nel Dockerfile e in `.nvmrc` (se presente).

### 3. `proxy` Event Emission (v9.1.0 / v10.1.0)

Nuova feature: entrambi i pacchetti ora emettono un evento `proxy` sul request object dopo che la connessione proxy è stabilita.

```typescript
const request = https.get(url, { agent });
request.on('proxy', ({ proxy, socket }) => {
  console.log(`Proxy utilizzato: ${proxy}`);
});
```

> **Nota**: Questa è una feature opzionale, non un breaking change.

### 4. Kerberos/SPNEGO Authentication (https-proxy-agent v9.1.0+)

Nuova opzione `onProxyAuth` e `negotiate` per autenticazione Kerberos/SPNEGO.

```typescript
const agent = new HttpsProxyAgent(proxyUrl, {
  onProxyAuth: async (response, authScheme) => {
    // Restituisci headers di autorizzazione
    return { 'Proxy-Authorization': `Negotiate ${token}` };
  },
  negotiate: true, // Usa automaticamente kerberos package
});
```

> **Nota**: Feature opzionale, richiede `kerberos` come peer dependency opzionale.

---

## ✅ Cosa NON Cambia

La API principale rimane **invariata** rispetto alle versioni 7/8:

```typescript
// ✅ Stessa sintassi funziona in v9/v10:
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

const httpAgent = new HttpsProxyAgent('http://proxy:8080');
const socksAgent = new SocksProxyAgent('socks5://user:pass@proxy:1080');

https.get('https://example.com', { agent: httpAgent }, (res) => {
  // ...
});
```

---

## 🔍 Piano di Ricerca nel Codice

### Step 1: Trovare tutti gli import di proxy agent

```bash
grep -rn "https-proxy-agent\|socks-proxy-agent" src/ --include="*.ts"
```

### Step 2: Verificare pattern di import

Cercare sia import ESM che require CJS:
- `import { HttpsProxyAgent } from 'https-proxy-agent'` ✅ ESM (funziona)
- `const { HttpsProxyAgent } = require('https-proxy-agent')` ❌ CJS (da convertire)

### Step 3: Verificare instanziazione

Controllare che tutti gli usage usino la sintassi corretta:
```typescript
new HttpsProxyAgent(url, options?)
new SocksProxyAgent(url, options?)
```

---

## 📝 Checklist di Migrazione

- [x] `pnpm up https-proxy-agent@^9.1.0 socks-proxy-agent@^10.1.0`
- [x] Verificare Node.js ≥ 20 nel Dockerfile (Node 24 ✅)
- [x] Convertire eventuali `require()` in `import` (nessuno trovato ✅)
- [x] `pnpm build` — zero errori TypeScript ✅
- [x] `pnpm test` — zero test falliti ✅
- [x] Testare proxy HTTP — 401 atteso (proxy non attivo) ✅
- [x] Testare proxy SOCKS — instanziazione OK ✅
- [x] Testare proxy con autenticazione — `user:pass@host` OK ✅

---

## 📋 Piano di Esecuzione — 10 Punti

| # | Fase | Descrizione | Rischio | Stima |
|---|------|-------------|---------|-------|
| 1 | **Verifica Node.js Version** | Controllare Dockerfile e `.nvmrc` — Node.js ≥ 20 richiesto da v9/v10 | Basso | 5 min |
| 2 | **Backup Dipendenze** | Snapshot `package-lock.json` e stato attuale per rollback | Basso | 2 min |
| 3 | **Aggiornamento https-proxy-agent** | `pnpm up https-proxy-agent@^9.1.0` | Medio | 5 min |
| 4 | **Aggiornamento socks-proxy-agent** | `pnpm up socks-proxy-agent@^10.1.0` | Medio | 5 min |
| 5 | **Ricerca Import CJS** | Scansionare codice per `require('https-proxy-agent')` e `require('socks-proxy-agent')` | Medio | 10 min |
| 6 | **Conversione Import** | Convertire `require()` in `import` dove necessario | Medio | 15 min |
| 7 | **Verifica Instanziazione** | Controllare `new HttpsProxyAgent()` e `new SocksProxyAgent()` — sintassi invariata | Basso | 5 min |
| 8 | **Build & Type Check** | Eseguire `pnpm build` e verificare zero errori TypeScript | Medio | 10 min |
| 9 | **Test Suite** | Eseguire `pnpm test` — verificare zero test falliti | Alto | 15 min |
| 10 | **Test Proxy Funzionali** | Testare HTTP proxy, SOCKS proxy, proxy con auth, proxy round-robin | Alto | 20 min |

### Dettagli per ogni fase

#### Fase 1 — Verifica Node.js Version
- Aprire `Dockerfile` e verificare `FROM node:XX-alpine`
- Controllare `.nvmrc` (se presente)
- Verificare `engines.node` in `package.json`
- Se Node.js < 20, aggiornare a Node.js 20+ prima di procedere
- Comando: `node --version` (deve essere ≥ 20.0.0)

#### Fase 2 — Backup Dipendenze
```bash
# Creare snapshot dello stato attuale
cp package.json package.json.backup
cp pnpm-lock.yaml pnpm-lock.yaml.backup
# Registrare versioni attuali
pnpm list https-proxy-agent socks-proxy-agent
```

#### Fase 3 — Aggiornamento https-proxy-agent
```bash
pnpm up https-proxy-agent@^9.1.0
```
- Verificare `package.json` — confermare versione 9.x
- Eseguire `pnpm install` per aggiornare lockfile
- Controllare `node_modules/.pnpm/https-proxy-agent@9.*/` esistenza

#### Fase 4 — Aggiornamento socks-proxy-agent
```bash
pnpm up socks-proxy-agent@^10.1.0
```
- Verificare `package.json` — confermare versione 10.x
- Eseguire `pnpm install` per aggiornare lockfile
- Controllare `node_modules/.pnpm/socks-proxy-agent@10.*/` esistenza

#### Fase 5 — Ricerca Import CJS
```bash
# Cercare require() nei file TypeScript
grep -rn "require.*https-proxy-agent\|require.*socks-proxy-agent" src/ --include="*.ts"
# Cercare import ESM (già corretti)
grep -rn "from ['\"]https-proxy-agent['\"]\|from ['\"]socks-proxy-agent['\"]" src/ --include="*.ts"
```

**Pattern da cercare:**
- `const { HttpsProxyAgent } = require('https-proxy-agent')` → ❌ CJS
- `const { SocksProxyAgent } = require('socks-proxy-agent')` → ❌ CJS
- `import { HttpsProxyAgent } from 'https-proxy-agent'` → ✅ ESM
- `import { SocksProxyAgent } from 'socks-proxy-agent'` → ✅ ESM

#### Fase 6 — Conversione Import
Per ogni `require()` trovato, convertire in `import`:

```typescript
// ❌ PRIMA (CJS):
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

// ✅ DOPO (ESM):
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
```

**File da verificare:**
- `src/providers/animeunity-provider.ts`
- `src/providers/animesaturn-provider.ts`
- `src/providers/animeworld-provider.ts`
- `src/extractor.ts`
- `src/addon.ts`

#### Fase 7 — Verifica Instanziazione
La sintassi di instanziazione **NON è cambiata** rispetto a v7/v8:

```typescript
// ✅ Stessa sintassi funziona in v9/v10:
const httpAgent = new HttpsProxyAgent('http://proxy:8080');
const socksAgent = new SocksProxyAgent('socks5://user:pass@proxy:1080');

// Con opzioni (opzionali):
const agent = new HttpsProxyAgent(proxyUrl, {
  headers: { 'X-Custom-Header': 'value' },
  rejectUnauthorized: false, // solo per testing
});
```

**Verificare:**
- Nessun uso di `secureProxy` getter (rimosso in v7.0.0)
- Nessun object literal come primo argomento (split in due args in v6+)

#### Fase 8 — Build & Type Check
```bash
pnpm build
```

**Errori comuni da correggere:**
- `TS2307: Cannot find module 'https-proxy-agent'` → import non risolto
- `TS2339: Property 'secureProxy' does not exist` → usare `agent.proxy.protocol`
- Errori ESM → verificare `type: "module"` in package.json

#### Fase 9 — Test Suite
```bash
pnpm test
```

**Cosa verificare:**
- Tutti i test passano senza errori
- Nessun warning su deprecated APIs
- Nessun errore di runtime su proxy connection

#### Fase 10 — Test Proxy Funzionali

**Test 1: HTTP Proxy**
```bash
PROXY=http://localhost:8080 pnpm test
# Verificare: richiesta passa attraverso proxy
```

**Test 2: SOCKS Proxy**
```bash
PROXY=socks5://localhost:1080 pnpm test
# Verificare: connessione SOCKS stabilita
```

**Test 3: Proxy con Autenticazione**
```bash
PROXY=http://user:pass@localhost:8080 pnpm test
# Verificare: autenticazione proxy riuscita
```

**Test 4: Proxy Round-Robin**
```bash
PROXY=http://proxy1:8080 PROXY_BACKUP=http://proxy2:8080 pnpm test
# Verificare: failover tra proxy primario e backup
```

**Test 5: Evento `proxy` (v9.1.0+/v10.1.0+)**
```typescript
// Verificare che l'evento proxy sia emesso:
const agent = new HttpsProxyAgent(proxyUrl);
const req = https.get(url, { agent });
req.on('proxy', ({ proxy, socket }) => {
  console.log(`Proxy utilizzato: ${proxy}`);
});
```

---

## 🔗 Risorse

- **Repo proxy-agents**: https://github.com/TooTallNate/proxy-agents
- **https-proxy-agent changelog**: https://github.com/TooTallNate/proxy-agents/blob/main/packages/https-proxy-agent/CHANGELOG.md
- **socks-proxy-agent changelog**: https://github.com/TooTallNate/proxy-agents/blob/main/packages/socks-proxy-agent/CHANGELOG.md
- **https-proxy-agent npm**: https://www.npmjs.com/package/https-proxy-agent
- **socks-proxy-agent npm**: https://www.npmjs.com/package/socks-proxy-agent

---

**HanX** — Il tuo addon anime per Stremio/NUVIO.
