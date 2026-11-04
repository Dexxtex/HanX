<p align="center">
  <img src="public/banner.jpg" alt="HanX" width="100%">
</p>

<h2 align="center">Addon Stremio per anime</h2>

<p align="center">
  Stream da AnimeUnity, AnimeSaturn e AnimeWorld in un'unica interfaccia.
</p>

| AnimeUnity | AnimeSaturn | AnimeWorld |
|:---:|:---:|:---:|
| <img src="public/provider-animeunity.jpg" alt="AnimeUnity" width="250"> | <img src="public/provider-animesaturn.jpg" alt="AnimeSaturn" width="250"> | <img src="public/provider-animeworld.jpg" alt="AnimeWorld" width="250"> |

![Node](https://img.shields.io/badge/node-%3E%3D24-green)
![Docker](https://img.shields.io/badge/docker-ready-blue)

> **Progetto vibecoded.** Derivato di [StreamViX](https://github.com/qwertyuiop8899/StreamViX)
> e scritto con agenti AI: nessuna garanzia di stabilità o supporto. Va usato a
> proprio rischio. Non è affiliato a StreamViX né ai siti di streaming.

## Cosa fa

- Cerca sui tre provider in parallelo, con fallback quando uno non risponde.
- Accetta ID **MAL**, **Kitsu**, **IMDb**, **TMDB** e **TVDB**.
- Riproduce in **diretta** o tramite **EasyProxy** (HLS).
- Ha una pagina di configurazione: scegli le sorgenti e ottieni il link da
  incollare in Stremio.
- Consulta un catalogo locale dei tre siti prima di chiedere al sito: meno
  ricerche, risposte più rapide.
- Rispetta i limiti dei siti (pacing, cache, stop su `403`/`429`).

## Avvio rapido

Serve Docker con Compose v2. Salva come `compose.yaml`:

```yaml
services:
  hanx:
    image: lextutor/hanx:latest
    container_name: HanX
    ports:
      - "${PORT:-7000}:${PORT:-7000}"
    volumes:
      - hanx-data:/app/data
    env_file:
      - .env
    restart: unless-stopped

volumes:
  hanx-data:
```

Poi crea il `.env` e avvia:

```bash
cp .env.example .env     # compila almeno le 3 variabili obbligatorie
docker compose up -d
```

Apri <http://localhost:7000>, scegli le sorgenti e installa l'addon in Stremio.
Per aggiornare: `docker compose pull && docker compose up -d`.

> Il volume `hanx-data` serve: contiene indice, catalogo e cache. Senza, il
> container riscarica tutto a ogni riavvio.

Immagine su Docker Hub (`lextutor/hanx:latest`) e GitHub Packages
(`ghcr.io/dexxtex/hanx:latest`). Per compilare dal sorgente:
`docker build -t lextutor/hanx:latest .`

## Configurazione

L'elenco completo, con descrizione e default, è in
[`.env.example`](.env.example). Queste tre sono obbligatorie:

| Variabile | A cosa serve |
| --- | --- |
| `ANIME_MAPPING_URL` | Traduce gli ID di Stremio in titolo e stagione. Senza, nessun ID si risolve |
| `CATALOG_URL` | Catalogo locale delle schede: senza, ogni titolo costa una ricerca di rete |
| `TMDB_API_KEY` | Titoli italiani e metadati: senza, si perdono i match sui siti che elencano in italiano |

Le altre che si toccano più spesso: `PORT`, `TVDB_API_KEY`/`TVDB_PIN`,
`EASYPROXY_URL`/`EASYPROXY_PASSWORD`, `PROXY`/`AU_PROXY`/`AS_PROXY`/`AW_PROXY`,
`*_ENABLED` per accendere o spegnere un provider, `DEBUG_LEVEL` (`0`–`4`).

Le chiavi restano nel `.env`: non committarlo. Se esponi la pagina su Internet,
proteggila con autenticazione davanti.

### Dietro un reverse proxy

Il link del manifest si costruisce da `X-Forwarded-Host`/`-Proto`: non serve
configurare host o porta. Il link `stremio://` richiede HTTPS (o `127.0.0.1`).
Se **Installa in Stremio** non parte, usa **Installa da Stremio Web** o incolla
il manifest a mano in Stremio → Addons.

```caddyfile
hanx.example.com {
    reverse_proxy 127.0.0.1:7000
}
```

## Riproduzione: diretta o con proxy

- **Diretta** — URL del sito con gli header corretti: funziona quando player e
  server escono dallo stesso IP pubblico.
- **Con proxy** — tutto passa da EasyProxy, che scarica manifest e segmenti dal
  suo IP. È un servizio separato
  ([realbestia1/EasyProxy](https://github.com/realbestia1/EasyProxy)): avvialo e
  metti URL e password nel `.env`.

I proxy `PROXY`/`AU_PROXY`/`AS_PROXY`/`AW_PROXY` sono un'altra cosa: servono allo
scraping, non alla riproduzione.

## Dati che scarica

All'avvio scarica due indici pubblici e li aggiorna da solo:

- il **mapping** (`anime-seasons.json`), che traduce gli ID di Stremio in titolo
  e stagione. L'addon lo scarica da `ANIME_MAPPING_URL` e tenta il controllo ogni 6 ore; il download effettivo avviene al massimo una volta ogni 24 ore (ETag). Se il download fallisce, continua con la copia locale.
- il **catalogo** delle schede dei tre siti, che evita la ricerca sul sito
  quando il titolo è già noto. Senza `CATALOG_URL` si usa la ricerca di rete.

Un titolo assente dal catalogo non viene mai dato per inesistente: passa
comunque dalla ricerca del sito.

## Limiti noti

- Il mapping non copre tutto il catalogo MAL: per gli altri la ricerca per
  titolo può non bastare.
- I siti sono dietro Cloudflare: insistere dopo un `403` peggiora le cose.
- Il catalogo è di ieri sera: un titolo appena aggiunto si trova solo con la
  ricerca di rete.

## Sviluppo

Node.js 24+, `pnpm install` poi `pnpm test` (build + test) e `pnpm run dev`.
Struttura: `src/` (addon, provider, mapping, catalogo), `scripts/` (build,
automazione, sync), `config/` (domini), `tests/`, `docs/` (ricognizione).
