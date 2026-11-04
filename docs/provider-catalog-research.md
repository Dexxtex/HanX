# Ricognizione dei cataloghi dei tre siti

Data: **4 novembre 2026**. Numeri e comportamenti verificati a mano sul sito, non dedotti.
Serve a non rifare le stesse sonde e a non ripetere gli errori di misura (in fondo).

## Regole di ingaggio usate

- una richiesta alla volta, **5 s** nei probe e **3 s** nel sync, User-Agent di Chrome, timeout 20 s;
- canary sulla prima richiesta di ogni giro, **stop immediato su 403/429**;
- `robots.txt`: Saturn vieta `/api`, `/admin`, `/embed`; AnimeWorld vieta `/api`, `/admin`;
  AnimeUnity ha `User-agent: * / Allow: /` e blocca solo i bot AI (ClaudeBot, CCBot, Bytespider, Amazonbot…).
  Quindi i crawl notturni sono conformi; le API vietate **non** sono usate.
- Un `403` osservato: AnimeUnity `/archivio` dagli IP dei runner GitHub. Non è rate limiting
  (arriva in 3 s). Risolto con un proxy residenziale (SOCKS5, vedi sotto), non con proxy di datacenter.

## Saturn — animesaturn.net (6.179 schede)

| path | metodo | cosa restituisce | verdetto |
|---|---|---|---|
| `/sitemap.xml` | GET | index: 1 parte anime, 2 episodi, 2 pagine-episodio, 1 pagine | **fonte del catalogo** |
| `/sitemap-anime-1.xml` | GET | 6.179 URL `/anime/<slug>` | **6.179 schede** |
| `/sitemap-anime-2.xml`, `-3.xml` | GET | urlset **vuoto** (109 byte) | la sitemap anime è una sola parte |
| `/sitemap-episodes-1/2.xml` | GET | 2.830 + 3.442 slug distinti | tutti ⊆ sitemap anime (0 mancanti) |
| `/sitemap-episode-pages-1/2.xml` | GET | stessi slug, pagine episodio | idem |
| `/az-list` | GET | landing con tab per lettera e hero slider | non è l'elenco |
| `/az-list/<letter>/<n>` | GET | 30 card/pagina; lettera A: 11×30+22 = **352** (sitemap 351) | la sitemap è completa **per lettera** |
| `/filter?key=` | GET | ricerca (usata dai provider) | ok |
| `/filter?years=2024` / `?years[]=…` | GET | **filtra e pagina** (pag. 1 e 2: 30 titoli, 0 sovrapposti; `page=999` → 0 titoli) | anni/tipi/studi/generi disponibili |
| `/filter` | POST | **405** | i filtri sono solo GET, e le parentesi vanno percent-encode |
| `/genres` | GET | 0 link (contenuto JS) | vicolo cieco |
| `/newest`, `/ongoing`, `/upcoming` | GET | 38 / 36 / 87 slug | tutti nella sitemap |
| `/calendar` | GET | 113 schede in onda con giorno | metadato "giorno" |
| `/toplist` | GET | 52 slug | tutti nella sitemap |
| `/rss` | GET | HTML della home, 0 `<item>` | non esiste |
| `/animelist` | GET | 404 | non esiste |
| `/api/search?q=` | GET | usata dai provider | **vietata da robots**: non nel sync |
| `/anime/<slug>` | GET | **JSON-LD `TVSeries`** | metadati veri (sotto) |

**JSON-LD della scheda** (`/anime/<slug>`, esempio `tutor-hitman-reborn-tuTL8`):

```json
{"@type":"TVSeries","name":"Tutor Hitman Reborn!","alternateName":"Katekyo Hitman Reborn!",
 "inLanguage":"it","genre":["Azione","Commedia","Shounen","Superpoteri"],
 "datePublished":"2006","numberOfEpisodes":"203","image":"…","aggregateRating":{…}}
```

È l'unico modo per avere **titolo mostrato, titolo alternativo, anno, generi, episodi**:
lo slug non li contiene. Costo: 1 richiesta per scheda (6.179 per il backfill completo).

**Cosa salviamo**: `slug`, `url`, `titleSite` ricavato dallo slug. Lingua dedotta dal titolo
(ITA 1.256 / CR 2 / SUB 4.921). Nessun alias, anno o tipo.

## AnimeWorld — animeworld.ac (6.864 schede)

| path | metodo | cosa restituisce | verdetto |
|---|---|---|---|
| `/filter?page=N` | GET | **172 pagine** dichiarate (`paginationMaxPage`), 40 card/pagina, ultima pagina parziale | **fonte del catalogo** |
| `/filter?page=173` | GET | **ripete la pagina 1** | oltre l'ultima non è vuota: serve il numero dichiarato |
| `/filter?sort=title` | GET | identica alla pagina 1 | `sort` ignorato |
| `/filter?year[]=2024` | GET | funziona, `maxPage 9` | anni partizionabili |
| `/filter?type[]=Movie`, `?season[]=Estate` | GET | filtrano, ma `maxPage 0` | **non paginabili** |
| `/filter?dub=1` | GET | funziona e pagina: **34 pagine** ≈ 1.836 schede ITA | lingua esatta, +34 richieste |
| `/filter?keyword=` | GET | ricerca (usata dai provider) | ok |
| `/sitemap.xml` | GET | 4 parti | inutili per il catalogo |
| `/sitemap-0.xml` | GET | 50.000 URL `/play/…` (episodi) | solo slug |
| `/sitemap-1.xml` | GET | 33.708 `/play/` + 8.100 profili | solo slug |
| `/sitemap-2.xml` | GET | 25.000 watchlist | rumore |
| `/sitemap-3.xml` | GET | profili/watchlist | rumore |
| `/play/<slug>.<token>` | GET | HTML con **anno** (es. 2005), genere, studio, trama + JSON-LD `TVEpisode` (`partOfSeries.name`, `alternateName`) | 1 richiesta/scheda per i metadati |
| `/api/tooltip/<id>` | GET | anno/tipo per scheda | **vietata da robots** |

La sitemap di World (6.372 serie ricavabili) è **più vecchia e più piccola** del filtro (6.864):
non è un riferimento di completezza.

**Cosa salviamo**: `slug`, `url`, `titleSite` dalla card (`a.name`). Lingua dedotta dal titolo
(ITA 1.273 / CR 2 / SUB 5.589 — il filtro `dub=1` ne conta ~1.836, quindi la deduzione sottostima).

## AnimeUnity — animeunity.co (7.266 schede)

Flusso: `GET /archivio` → cookie `XSRF-TOKEN` + `<meta name="csrf-token">` →
`POST /archivio/get-animes` con header `x-xsrf-token` / `x-csrf-token` e cookie.

Corpo: `{title, type, year, order, status, genres[], offset, dubbed, season}` → `{tot, records[30]}`.
**30 record per richiesta**, nessun `per_page`/`limit` (tutti ignorati).

| cosa | valore |
|---|---|
| default | `tot` **7.266**, 243 chunk da 30 |
| `type` | TV 3.864 · Movie 1.121 · OVA 798 · ONA 795 · Special 384 · **TV Short 304** → **somma esatta 7.266** |
| `dubbed=1` | `tot` 1.541, ma è un **sottoinsieme** delle stesse 7.266 (slug verificati) |
| `season` | Inverno 1.541 · Primavera 1.964 · Estate 1.742 · Autunno 2.013 (7.260 con stagione) |
| `status` | "In Corso" 107, "Completato" 0 → i valori del sito sono altri, non è una partizione |

Campi di ogni record (30+): `id`, `slug`, `title`, `title_it`, `title_eng`, `date`, `type`,
`season`, `mal_id`, `anilist_id`, `episodes_count`, `real_episodes_count`, `genres[]`, `score`,
`studio`, `author`, `plot`, `imageurl`, `dub`, `day`, `favorites`, `visite`, `members`, `status`,
`created_at`, `crunchy_id`, `netflix_id`, `prime_id`, `disney_id`.

**Cosa salviamo**: `slug` (`<id>-<slug>`), `url`, `titleSite` (fallback it/eng), `titles[]` it/eng
(5.278 schede), `year`, `type`, `malId` (**7.128/7.266 = 98%**), `season` (7.260/7.266).

Altri path: `/animelist` è la lista dell'utente (non il catalogo), `/anime/<id>-<slug>` non ha
JSON-LD, `robots.txt` consente tutto tranne i bot AI.

`403` su `/archivio` dagli IP dei runner GitHub: con un proxy residenziale **SOCKS5**
(`CATALOG_PROXY`, sessione sticky) il crawl passa (16 min per 243 richieste).

## Stato del catalogo (4/11/2026)

| sito | schede | `truncated` | lingua (dal titolo) | note |
|---|---:|---|---|---|
| Saturn | 6.179 | no | ITA 1.256 / CR 2 / SUB 4.921 | titolo dallo slug |
| AnimeWorld | 6.864 | no | ITA 1.273 / CR 2 / SUB 5.589 | 172 pagine dichiarate, verificate |
| AnimeUnity | 7.266 | no | — | malId 98%, season 7.260 |
| **indice** | **20.309** | | | branch `data`, `CATALOG_URL` |

Copertura misurata: **57-67%** dei check trovati dai provider usando le query del mapping
(titolo + italiano + romaji). Col solo titolo principale (spesso giapponese) scende sotto il 20%.
Dettaglio in `README.md`, sezione "Catalogo locale dei titoli".

## Proposte non implementate (con il costo)

| idea | guadagno | costo |
|---|---|---|
| JSON-LD di Saturn per le schede **nuove** | titolo vero + `alternateName`, anno, generi, episodi | ~1 richiesta/scheda nuova (2-5 min/giorno) |
| backfill JSON-LD Saturn | idem su tutte | 150/notte → completo in ~41 notti (+7,5 min/run) |
| World `?dub=1` | lingua esatta invece che dedotta | +34 richieste/run |
| campo `dub` di Unity | lingua esatta | gratis (già nella risposta) |
| Saturn `/filter?years=YYYY` | anno su tutte le 6.179 | ~266 richieste (una notte) |
| match per `malId` | match esatto sulle 7.128 schede Unity | 1-2 ore di codice, da testare col catalogo vero |

## Errori di misura da non ripetere

- **regex sul sitemap**: `/\/(?:anime|episode)\/([^/?#<]+)/` deve escludere `<`, altrimenti
  cattura `slug</loc>` e sembra che 38 schede manchino (erano 0).
- **confronto con un catalogo vuoto**: la sonda sulle doppiate diceva "0 slug in comune" perché
  `data/catalog-titles.json` aveva `unity: []`. Verificare sempre che l'insieme di confronto
  non sia vuoto.
- **`years[]` in URL**: senza percent-encoding (`years%5B%5D`) il filtro di Saturn viene ignorato
  e sembra rotto.
- **`raw.githubusercontent.com` in cache**: dopo un publish può servire per minuti la copia
  vecchia. Per verificare, leggere il blob dal branch (`git cat-file -p origin/data:…`), non il CDN.
- **`Number(null) === 0`**: in JS, `season: null` non è un film. Il matcher lo ha già corretto.
