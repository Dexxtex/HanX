# Scegli un'immagine Node.js di base
FROM node:26-slim

# Installa python3 e curl (usati nei workflow GitHub)
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Crea un symlink per python
RUN ln -s /usr/bin/python3 /usr/bin/python

# Imposta la directory di lavoro nell'immagine
WORKDIR /usr/src/app

# Installa pnpm
RUN npm install -g pnpm@12.10.1

# Copia i file del progetto nella directory di lavoro
COPY . .

# Fissa i permessi per l'utente node
RUN chown -R node:node /usr/src/app

# Torna all'utente node per le operazioni di pnpm e l'esecuzione dell'app
USER node

# Installa dipendenze
RUN rm -rf node_modules .pnpm-store dist 2>/dev/null || true
RUN pnpm install --prod=false

# Fix per il problema undici su ARM/Raspberry Pi
RUN pnpm add undici@6.19.8

# Esegui il build dell'applicazione TypeScript
RUN pnpm run build


# Avvio diretto dell'addon (lo script wrapper /start per Beamup non serve più)
ENTRYPOINT ["node", "dist/addon.js"]
