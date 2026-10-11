# syntax=docker/dockerfile:1

# ============================
# Stage 1: Build
# ============================
FROM node:26-alpine AS builder

WORKDIR /app

# Installa certificati e curl (usati nei workflow GitHub)
RUN apk add --no-cache ca-certificates curl

# Installa pnpm direttamente
RUN npm install -g pnpm@12.11.2

# Copia manifest e lockfile per cache ottimale
COPY package.json pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./

# Installa TUTTE le dipendenze (dev incluse necessarie per build)
RUN pnpm install --frozen-lockfile

# Fix per il problema undici su ARM/Raspberry Pi
RUN pnpm add undici@6.19.8

# Copia il resto del progetto
COPY . .

# Esegue il build
RUN pnpm run build

# Copia public/ dentro dist/ (build-copy.js non lo fa)
RUN cp -r public dist/

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

# Copia build artifacts
COPY --from=builder --chown=appuser:nodejs /app/dist ./dist
COPY --from=builder --chown=appuser:nodejs /app/node_modules ./node_modules

# Switcha a utente non-root
USER appuser

EXPOSE 7000

# Health check per orchestrator (Docker/Kubernetes)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:7000/', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# CMD exec form (non shell) per corretto signal handling
CMD ["node", "dist/addon.js"]
