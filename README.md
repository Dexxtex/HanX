<p align="center">
  <img src="public/banner.jpg" alt="HanX" width="100%">
</p>

<h2 align="center">Addon Stremio per anime</h2>

<p align="center">Stream da <b>AnimeUnity</b>, <b>AnimeSaturn</b> e <b>AnimeWorld</b> in un'unica interfaccia.</p>

<p align="center">
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D26-green" alt="Node 26+"></a>
  <a href="https://hub.docker.com/r/lextutor/hanx"><img src="https://img.shields.io/badge/docker-ready-blue" alt="Docker"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT"></a>
</p>

> [!IMPORTANT]
> **Progetto vibecoded.** Derivato di [StreamViX](https://github.com/qwertyuiop8899/StreamViX) e
> scritto con agenti AI: nessuna garanzia di stabilità o supporto, va usato a proprio
> rischio. Non è affiliato a StreamViX, a Stremio né ai siti di streaming.

---

## Cosa fa

- Cerca sui tre provider in parallelo, con fallback quando uno non risponde.
- Accetta ID **MAL**, **Kitsu**, **IMDb**, **TMDB** e **TVDB**.
- Riproduce in **diretta** o tramite **EasyProxy** (HLS).
- Ha una pagina di configurazione: scegli le sorgenti e ottieni il link da
  incollare in Stremio.
- Consulta un catalogo locale dei tre siti prima di chiedere al sito, e rispetta i
  loro limiti (pacing, cache, stop su `403`/`429`).

| AnimeUnity | AnimeSaturn | AnimeWorld |
|:---:|:---:|:---:|
| <img src="public/provider-animeunity.jpg" alt="AnimeUnity" width="250"> | <img src="public/provider-animesaturn.jpg" alt="AnimeSaturn" width="250"> | <img src="public/provider-animeworld.jpg" alt="AnimeWorld" width="250"> |

## Avvio rapido

Serve Docker con Compose v2.

1. **Scarica `docker-compose.yml` e il modello del `.env`:**

   ```bash
   curl -O https://raw.githubusercontent.com/Dexxtex/HanX/main/docker-compose.yml
   curl -o env.example https://raw.githubusercontent.com/Dexxtex/HanX/main/env.example
   cp env.example .env
   ```

   Il compose elenca tutte le variabili con il loro default: il `.env` le
   sovrascrive, e ogni default si legge dove serve.

2. **Compila il `.env`.** Le tre obbligatorie sono nella tabella qui sotto; senza
   `CATALOG_URL` e `TMDB_API_KEY` l'addon funziona ma degrada.

3. **Avvia:**

   ```bash
   docker compose up -d
   ```

4. **Configura:** apri <http://localhost:7000>, scegli le sorgenti e installa
   l'addon in Stremio.

> [!NOTE]
> Il volume `hanx-data` contiene indice, catalogo e cache. Senza, il container
> riscarica tutto a ogni riavvio.

Per aggiornare: `docker compose pull && docker compose up -d`.

Immagini: [Docker Hub](https://hub.docker.com/r/lextutor/hanx) (`lextutor/hanx:latest`)
e GitHub Packages (`ghcr.io/dexxtex/hanx:latest`). Per compilare dal sorgente:
`docker build -t lextutor/hanx:latest .`

## Configurazione

L'elenco completo, con descrizione e default, è in [`env.example`](env.example).

| Variabile | A cosa serve |
| --- | --- |
| `ANIME_MAPPING_URL` | Traduce gli ID di Stremio in titolo e stagione. Senza, ogni ID passa dalla risoluzione live (Kitsu/TMDB/TVDB): funziona, ma più lento e con match peggiori |
| `CATALOG_URL` | Catalogo locale delle schede: senza, ogni titolo costa una ricerca di rete |
| `TMDB_API_KEY` | Titoli italiani e metadati. Senza, gli ID fuori dall'indice non hanno titolo inglese e il provider risponde con zero stream |

Le altre che si toccano più spesso: `PORT`, `TVDB_API_KEY`/`TVDB_PIN`,
`EASYPROXY_URL`/`EASYPROXY_PASSWORD`, `PROXY`/`AU_PROXY`/`AS_PROXY`/`AW_PROXY`,
`*_ENABLED` come interruttore: `false` spegne un provider, `true` non lo accende
(decidono le checkbox della pagina di configurazione), `DEBUG_LEVEL` (`0`–`4`).

> [!WARNING]
> Le chiavi restano nel `.env`: non committarlo. Se esponi la pagina su Internet,
> proteggila con autenticazione davanti.

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
- Il catalogo si aggiorna una volta al giorno: un titolo aggiunto dopo l'ultimo
  aggiornamento non è ancora indicizzato e passa dalla ricerca di rete.

## Licenza e avvertenze

Codice sotto licenza [MIT](LICENSE): usalo, modificalo e ridistribuiscilo, senza
garanzie di alcun tipo.

HanX non ospita, non memorizza e non trasmette contenuti: interroga i siti
configurati e restituisce i link che quei siti espongono. Non è affiliato ai siti,
ai titolari dei diritti, a Stremio o a StreamViX.

Chi installa l'addon verifica da sé di poter accedere ai contenuti nella propria
giurisdizione e di rispettare i termini d'uso delle fonti. Il progetto non aggira
misure tecniche di protezione e non fornisce nulla a questo scopo. Un'informativa
non esclude la responsabilità prevista dalla legge. Chi è titolare di diritti può
chiedere la rimozione di un riferimento scrivendo alla pagina delle issue: qui non
è ospitato nessun file.
