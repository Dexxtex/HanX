# 🐛 Issue Report — HanX Addon Stremio

## Stato Attuale

- ✅ Repository GitHub: `https://github.com/Dexxtex/HanX` (private)
- ✅ Build TypeScript: OK
- ✅ Dockerfile: Fix permessi applicato
- ❌ Landing page: Blank (fixato ma da verificare)
- ❌ Installazione Stremio: Non funziona (fixato con copia URL)
- ❌ Manifest endpoint: Da verificare su server remoto

---

## Problemi Identificati

### 1. Landing Page Bianca
**Sintomo:** Accedendo a `http://server:7000/` la pagina è bianca.

**Causa:** La funzione `landingTemplate()` in `src/landingPage.ts` non aveva un `return` statement. I template HTML (`guidedInstallationHTML`, `formHTML`, `script`) erano definiti ma mai restituiti.

**Fix applicato:**
- Aggiunto `return` che assembla l'HTML completo
- Chiusura corretta dei blocchi `if`
- Rimosso `export` dalla funzione

**File modificato:** `src/landingPage.ts`

---

### 2. Pulsante "Installa su Stremio" Non Funziona
**Sintomo:** Cliccare il pulsante non fa nulla.

**Causa:** Il protocollo `stremio://install-addon/` funziona solo se Stremio è installato **sullo stesso PC** del browser. Su server remoti (Beamup, Railway, ecc.) non c'è un client Stremio.

**Fix applicato:**
- Rimosso pulsante `stremio://`
- Aggiunto campo testo con URL manifest: `http://server:7000/manifest.json`
- Aggiunto pulsante "Copia URL Manifest"
- Istruzioni: incollare in Stremio → Home → Aggiungi addon → Installa da URL

**File modificato:** `src/landingPage.ts`

---

### 3. Modalità Veloce e Pulsante HELP
**Sintomo:** Toggle "Modalità Veloce" e pulsante "HELP" non dovevano esserci.

**Fix applicato:**
- Rimosso toggle `fastMode` dalla UI
- Rimosso pulsante HELP
- Rimosso popup FastMode
- Rimossi riferimenti a `fastMode` dai preset

**File modificato:** `src/landingPage.ts`

---

### 4. Docker Build Permission Error
**Sintomo:** `EACCES: permission denied` durante `pnpm install` nel Dockerfile.

**Causa:** Il Dockerfile faceva `COPY . .` (file owned by root), poi `USER node`, quindi `pnpm install` falliva per permessi.

**Fix applicato:**
- Aggiunto `RUN chown -R node:node /usr/src/app` dopo `COPY`
- Rimosso `pnpm-lock.yaml` da `.dockerignore` (serve per build)
- Rimossa `version: "3.9"` da `docker-compose.yml` (warning)

**File modificati:** `Dockerfile`, `.dockerignore`, `docker-compose.yml`

---

## Cosa Verificare in Nuova Chat

### Confronto addon.ts Originale vs Modificato

1. **Verificare che il router sia correttamente inizializzato:**
   ```typescript
   globalBuilder = createBuilder(configCache);
   globalAddonInterface = globalBuilder.getInterface();
   globalRouter = getRouter(globalAddonInterface);
   ```

2. **Verificare che il manifest endpoint sia accessibile:**
   - Endpoint: `/manifest.json`
   - Con config: `/<config>/manifest.json`
   - Il router deve essere mounted con `globalRouter(req, res, next)`

3. **Verificare la struttura del manifest:**
   - `types: ["anime"]`
   - `resources: ["stream", "meta"]`
   - `idPrefixes: ["tt", "kitsu", "mal", "tmdb"]`
   - `behaviorHints.configurable: true`
   - `config: [...]` — array di campi di configurazione

4. **Verificare che gli stream handler siano registrati:**
   - `builder.defineStreamHandler(...)`
   - `builder.defineMetaHandler(...)`

### File da Controllare

- `src/addon.ts` — logica principale, manifest, router
- `src/landingPage.ts` — UI configurazione
- `addon-config.json` — configurazione addon
- `Dockerfile` — build Docker
- `docker-compose.yml` — orchestrazione

### Endpoints da Verificare

| Endpoint | Descrizione | Stato |
|----------|-------------|-------|
| `/` | Landing page | ❓ Da verificare dopo deploy |
| `/manifest.json` | Manifest default | ❓ Da verificare |
| `/<config>/manifest.json` | Manifest con config | ❓ Da verificare |
| `/stream/anime/{id}.json` | Stream anime | ❓ Da verificare |
| `/meta/{type}/{id}.json` | Meta data | ❓ Da verificare |

---

## Comandi di Test Locale

```bash
# Build
pnpm run build

# Avvia server
node dist/addon.js

# Test manifest
curl http://localhost:7000/manifest.json

# Test stream
curl http://localhost:7000/stream/anime/mal:1.json

# Test landing page
curl http://localhost:7000/
```

---

## Note per la Nuova Chat

1. **Caricare prima l'addon.ts originale** (prima delle modifiche)
2. **Confrontare con l'addon.ts attuale** per vedere cosa è cambiato
3. **Verificare che la logica del manifest sia intatta**
4. **Controllare che il router serva correttamente gli endpoint**
5. **Verificare che gli stream handler funzionino**

---

**Ultimo commit:** `fix: manifest URL corretto — mostra URL HTTP copiabile per installazione Stremio`
**Data:** 2026-10-10
