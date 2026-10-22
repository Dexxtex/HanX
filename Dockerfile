# syntax=docker/dockerfile:1

# ============================
# Stage 1: Build
# ============================
FROM node:26-alpine AS builder

WORKDIR /app

# Installa i certificati CA per le chiamate HTTPS
RUN apk add --no-cache ca-certificates

# Installa la stessa versione di pnpm dichiarata in package.json
RUN npm install -g pnpm@12.10.1

# Copia manifest e lockfile per cache ottimale
COPY package.json pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./

# Installa TUTTE le dipendenze (dev incluse necessarie per build)
RUN pnpm install --frozen-lockfile

# Copia il resto del progetto
COPY . .

# Esegue il build e rimuove le dipendenze di sviluppo dall'immagine finale
RUN pnpm run build && pnpm prune --prod

# ============================
# Stage 2: Production Runner
# ============================
FROM node:26-alpine AS runner

WORKDIR /app

# Imposta ambiente produzione
ENV NODE_ENV=production \
    NODE_OPTIONS="--enable-source-maps"

# Crea utente non-root con uid/gid espliciti (best practice Node.js Docker docs)
RUN addgroup -g 1001 -S nodejs && \
    adduser -u 1001 -S appuser -G nodejs

# Directory for persistent SQLite metadata cache (mounted as a named volume)
RUN mkdir -p /app/data && chown appuser:nodejs /app/data && chmod 700 /app/data

# Copia build artifacts
COPY --from=builder --chown=appuser:nodejs /app/dist ./dist
COPY --from=builder --chown=appuser:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:nodejs /app/package.json ./package.json
COPY --from=builder --chown=appuser:nodejs /app/addon-config.json ./addon-config.json
COPY --from=builder --chown=appuser:nodejs /app/config ./config
COPY --from=builder --chown=appuser:nodejs /app/public ./public

# Switcha a utente non-root
USER appuser

EXPOSE 7000

# Health check per orchestrator (Docker/Kubernetes)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const port = process.env.PORT || 7000; require('http').get('http://127.0.0.1:' + port + '/', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# CMD exec form (non shell) per corretto signal handling
CMD ["node", "dist/addon.js"]
