# StreamViX

**Addon Stremio/NUVIO esclusivo per anime** — Streaming da AnimeUnity, AnimeSaturn e AnimeWorld.

![Version](https://img.shields.io/badge/version-12.4.23-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20-green)
![Docker](https://img.shields.io/badge/docker-ready-blue)

## 🎯 Caratteristiche

- **Multi-Provider**: AnimeUnity, AnimeSaturn, AnimeWorld
- **MediaFlow Proxy**: Supporto per proxy avanzato (EasyProxy/MediaFlow)
- **HLS Streaming**: Compatibile con player moderni
- **Docker Ready**: Build e deploy semplificati
- **Configurazione Web**: Interfaccia di configurazione integrata

## 📦 Installazione

### Docker (Consigliato)

```bash
# Clona il repository
git clone https://github.com/TUO_USERNAME/streamvix-addon.git
cd streamvix-addon

# Crea il file .env
nano .env

# Avvia con docker-compose
docker-compose up -d
```

### Variabili d'ambiente

```env
PORT=7000
TMDB_API_KEY=la_tua_chiave
ANIMEUNITY_ENABLED=true
ANIMESATURN_ENABLED=true
ANIMEWORLD_ENABLED=true
MFP_URL=http://tuo-proxy:3000
MFP_PSW=tua_password
```

### Build manuale

```bash
pnpm install
pnpm run build
node dist/addon.js
```

## 🔧 Configurazione

Accedi all'interfaccia web: `http://localhost:7000/`

Dalla pagina di configurazione puoi:
- Abilitare/disabilitare i provider
- Configurare MediaFlow Proxy
- Impostare la TMDB API Key
- Scegliere tra modalità Direct o Proxy

## 🌐 API Endpoints

| Endpoint | Descrizione |
|----------|-------------|
| `/stream/anime/{id}.json` | Cerca stream per anime |
| `/stream/film/{id}.json` | Cerca stream per film |
| `/stream/serie/{id}.json` | Cerca stream per serie |

**ID supportati:** `kitsu:123`, `mal:123`, `tt1234567`, `tmdb:12345`

## 📁 Struttura

```
streamvix-addon/
├── src/
│   ├── addon.ts           # Entry point principale
│   ├── landingPage.ts     # Interfaccia web
│   └── providers/         # Provider anime
│       ├── animeunity-provider.ts
│       ├── animesaturn-provider.ts
│       └── animeworld-provider.ts
├── config/                # Configurazioni
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## 🐳 Docker

### Build immagine
```bash
docker build -t streamvix:latest .
```

### Avvia container
```bash
docker-compose up -d
```

### Log
```bash
docker logs -f StreamVix
```

### Ferma
```bash
docker-compose down
```

## ⚠️ Note

- Richiede Node.js 20+
- Le API esterne (Jikan, TMDB) devono essere raggiungibili dal server
- MediaFlow Proxy è opzionale ma consigliato per migliori prestazioni

## 📄 Licenza

Questo progetto è sotto licenza proprietaria. Vedi `LICENSE.txt` per i dettagli.

## 🔗 Link

- **Repository**: https://github.com/TUO_USERNAME/streamvix-addon
- **Issues**: https://github.com/TUO_USERNAME/streamvix-addon/issues

---

**StreamViX** — Il tuo addon anime per Stremio/NUVIO.
