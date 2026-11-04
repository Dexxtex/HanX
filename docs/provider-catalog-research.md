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
| `/anime/<slug>` | GET | **JSON-LD `TVSeries`** + `Lingua <Giapponese|Italiano>` e i link MAL/AniList | metadati veri (sotto) |

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
| `/play/<slug>.<token>` | GET | JSON-LD `TVEpisode` (`partOfSeries.name`, `alternateName`) + blocco `<dt>/<dd>` con **Anno**, **Audio** (Italiano/Giapponese), **Data di Uscita**, **Stagione**, **Episodi**, Studio, Durata, Stato, Visualizzazioni | 1 richiesta/scheda; si usano solo anno, data, episodi e lingua |
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

## Run verificate (4/11/2026)

| run | durata | risultato |
|---|---:|---|
| `41822506940` (primo, Unity dietro SOCKS) | 26,3 min | `data` → `432d863`: 6.179 / 6.864 / 7.266 |
| `41826771697` (codice ripulito, niente di nuovo) | 23,1 min | stessi conteggi, **nessun commit**: "Solo generatedAt" |

Tempi: Saturn 4,6 s, World 562 s (172 pagine), Unity 795 s (243 richieste da 30).
Il run delle 11:38 falliva con `403` su `/archivio` (Unity, IP datacenter); quello
delle 12:38 con `CATALOG_PROXY` SOCKS5 è passato. Il run fallito **non** ha
pubblicato nulla: il confronto senza `generatedAt` ha funzionato.

## Cosa è emerso dopo (5/11/2026)

### Saturn: la scheda espone `malId` e `anilistId`

`/anime/<slug>` contiene un blocco `<div class="ag-links">` con i link a MyAnimeList e AniList:

| scheda | `mal` | `anilist` |
|---|---:|---:|
| `tutor-hitman-reborn-tuTL8` | 1604 | 1604 |
| `boruto-naruto-next-generations-Mw2hG` | 34566 | 97938 |

Sta nella stessa pagina del JSON-LD: **una richiesta per scheda** porta titolo vero,
`alternateName`, anno, generi, episodi e i due id. Il listing `/filter` invece non contiene
**nessun** link a MyAnimeList (0 occorrenze su 461 KB): non c'è una via bulk, l'unica è
pagare 1 richiesta per scheda.

La sitemap ha `lastmod` su **6.171 URL su 6.179** (`changefreq` su tutti): permette di
scegliere *quali* schede rileggere — nuove e aggiornate — invece del solo delta per slug.
Va salvato per scheda (una data ISO, ~10 byte l'una).

### AnimeWorld: `data-jtitle` è un alias gratis

Ogni `<a class="name">` delle card ha un `data-jtitle` con il titolo canonico: **192 card su
192** (3 pagine), diverso dal nome mostrato su **85 (44%)**, e diverso anche dopo
normalizzazione di maiuscole e accenti su **80 (42%)**.

| nome mostrato | `data-jtitle` |
|---|---|
| `Kiseiju - L'ospite indesiderato` | `Parasyte -the maxim-` |
| `Ao no Exorcist` | `Blue Exorcist` |
| `Blood Blockade Battlefront` | `Kekkai Sensen` |
| `Sword Art Online 2` | `Sword Art Online II` |
| `Baby Steps 2` | `Baby Steps 2nd Season` |

È il titolo inglese o romaji che il matcher oggi non ha, ed è **già nell'HTML che il sync
scarica**: zero richieste in più. Il campo `titles[]` esiste già in `CatalogEntry` e finisce
negli alias dell'indice, quindi è una riga nel parser di World.

### Saturn: il listing `/filter` ha quasi tutto, e costa 206 richieste

La card dei risultati (30 per pagina, classe `ac`):

```html
<a href="/anime/<slug>" class="ac group">
  <div class="ac__poster"> … ★ 8.60 … </div>
  <div class="ac__caption">
    <h3 class="ac__title">The Holy Grail of Eris</h3>
    <p class="ac__sub">08 Gennaio 2026 &middot; 12 ep</p>
  </div>
</a>
```

Cioè **titolo mostrato vero** (non ricavato dallo slug), **data di inizio** al giorno,
numero di episodi e voto. I parametri del form sono **plurali** e coprono tutto:

| parametro | valori |
|---|---|
| `types[]` | TV · Movie · OVA · Special · ONA |
| `languages[]` | Giapponese · Italiano · Francese · Inglese · Coreano · Cinese |
| `seasons[]` | Primavera · Estate · Autunno · Inverno · Sconosciuta |
| `years[]`, `studios[]` (200+), `categories[]` (44), `states[]` (Finito/Droppato) | — |
| `key`, `dub`, `sort` | ricerca e lingua |

`type[]` **singolare** è la grafia sbagliata: risponde 200 con 0 risultati e nessun
`maxPage` (per questo la sonda precedente lo dava "non paginabile").

Conseguenza: **titolo vero, data, tipo, lingua e stagione per tutte le 6.179 schede
costano 206 richieste** — una passata partizionata per `types[]`, una per `languages[]`,
una per `years[]` — non 6.179. Il JSON-LD resta l'unica fonte di `malId`/`anilistId`,
`alternateName` e generi.

### AnimeWorld: anche `/play/<slug>` porta gli id esterni

`/play/mar-marchen-awakens-romance-ita.BNESr` contiene `myanimelist.net/anime/738` e
`anilist.co/anime/738`. Quindi **tutti e tre i siti** possono avere il match esatto per
`mal:<id>`; per World costa una richiesta per serie (6.864), per Saturn una per scheda,
per Unity è gratis nel record.

### Saturn: il walk `/filter` funziona senza filtri, e i filtri danno i metadati

- `/filter?page=1` → 30 card, `/filter?page=999` → **0 card**: il walk completo sono
  **206 pagine** e termina con una pagina vuota (nessun `maxPage` dichiarato).
- `types[]` (TV · Movie · OVA · Special · ONA) e `dub=1` **partizionano**: camminando per
  tipo, il tipo viene dal filtro e non dalla card (206 pagine in totale per dimensione).
- `languages[]=Italiano` **non** è il filtro delle doppiate: restituisce card senza "(ITA)"
  (`Araiya-san`, `The Promised Neverland`). Il filtro giusto è `dub=1`, che restituisce solo
  card con "(ITA)" nel titolo (`Sword Art Online: Alicization (ITA)`, `Promare (ITA)`).
- Il JSON-LD **non è affidabile sul tipo**: la scheda `dragon-ball-super-beerus-Q47P6` è un
  film ma dichiara `@type: TVSeries`. Il tipo va preso da `types[]`.
- `sort` esiste nel form ma non ha opzioni e nello HTML/JS del sito non c'è nulla che lo usi.

**Conclusione**: titolo vero (non dallo slug) e data di inizio costano 206 richieste; tipo e
lingua esatti costano una passata in più per dimensione. Tre passate = ~618 pagine ≈ 31 min a
3 s: troppo per lo stesso job da 45 min, quindi va scelta una dimensione (la lingua, con
`dub=1`, è quella che oggi deduciamo peggio).

### Nessun ordinamento per data in nessuno dei tre: niente delta

| sito | tentativo | esito |
|---|---|---|
| Saturn | `sort` (form senza opzioni), nessun JS di filtro | nessun ordinamento per data: walk alfabetico |
| World | `?sort=newest`, `?order=newest` | ignorati, stessa prima card |
| Unity | `order=recent`, `newest`, `updated`, `recente`, `aggiunti`, `visite`, `score`, `date` | tutti ignorati: `tot` e prime card identici a `order=title` |
| Saturn | `/newest?page=1`, `=2`, `=30` | pagina **identica**: 30 card fisse, non pagina |
| Saturn, World | `Accept: application/json` su `/filter` | sempre `text/html`: nessuna modalità JSON |

Il sync resta un crawl completo. L'unica cosa che permette di scegliere *cosa* rileggere è il
`lastmod` della sitemap Saturn, che però si applica alle schede, non alle pagine di listing.

### Attenzione: la ricerca del provider Saturn usa un path vietato da robots

`src/providers/animesaturn-provider.ts` interroga **`/api/search?q=` come prima scelta**, ma
`robots.txt` di Saturn dice `Disallow: /api`. Esiste già il fallback HTML su
`/filter?key=`, ed è quello che il doc dava per "la ricerca dei provider".

Misura del fallback su 10 schede vere, con query corte (prime due parole del titolo):

| esito | conteggio |
|---|---|
| trovata nei primi 5 risultati | **7/10** |
| trovata ma oltre il quinto | 0/10 |
| **zero risultati** | **3/10** (`Araiya San`, `Garouden The`, `Yotoden Chronicle`) |

Quindi la ricerca HTML è **letterale**: quando il titolo ricavato dallo slug diverge da quello
mostrato (punteggiatura, `:`/`&`, accenti) non trova nulla. Non è un sostituto equivalente
dell'API JSON, e questa è una decisione (compliance vs qualità), non una riga di codice.

### Il `malId` delle schede va validato, non solo letto

Le schede di Saturn e World portano **due** id esterni: MAL e AniList. Il confronto
utile non è col titolo (le schede italiane hanno titoli italiani, MAL è in romaji o
inglese), ma **id↔id**: `Media(id: <anilistId>) { idMal }` su AniList dice a quale
MAL corrisponde quell'AniList, e deve combaciare con il link MAL della scheda.

Misura su 8 schede a caso (4 Saturn, 4 World): **8/8 coerenti** (`Naruto` 2107/2107,
`Akame ga Kill` 22199/22199, `Black Clover` 34572/34572…). Il campione dice che il
sito per ora è pulito; la validazione resta perché un link sbagliato diventerebbe un
match esatto sbagliato, e il ramo esatto salta ogni controllo sul titolo. Costo: una
richiesta GraphQL ogni 25 schede, e le coppie senza id AniList non si salvano.

### L'indice mapping non è un ponte per gli id MAL

`anime-seasons.json` (13,5 MB) è un oggetto con chiavi `tvdb:…` / `kitsu:…` / `imdb:…`;
ogni voce ha `title` (spesso giapponese), `titleIt` e `seasons{…}` con `kitsuId`, `titleAlt`,
`episodeCount`. **Nessun `malId`**, nessun anno. Quindi gli id MAL si possono ottenere solo
dalle schede dei siti: non esiste un join locale che li ricavi gratis.

### AnimeUnity: niente di nuovo oltre ai 34 campi

Il record ha 34 campi, `mal_id` e `anilist_id` compresi (già documentati). Nessun campo
nuovo dopo malId: `created_at` c'è ma il sync è già completo in 16 minuti, un delta non
serve.

## Proposte non implementate (con il costo)

| idea | guadagno | costo |
|---|---|---|
| ~~match per `malId`~~ | **fatto**: per `mal:<id>` il matcher serve la scheda senza fuzzy (solo Unity) | — |
| ~~Saturn dal listing `/filter`~~ | **fatto**: titolo vero, `startDate`, `episodes` e `type` in più. La sitemap resta la spina (2 richieste): il listing arricchisce, non può perdere schede | 206 pagine ≈ 11,7 min misurati (15 pagine in 50,9 s); il job passa da 23 a ~35 min |
| ~~tipo di Saturn~~ | **fatto**: il walk `types[]` dà il tipo senza pagine in più |
| ~~lingua di Saturn~~ | **superato**: la scheda dichiara `Lingua Giapponese|Italiano`, presa dal backfill; `dub=1` sul listing non serve |
| ricerca del provider: `/filter?key=` al posto di `/api/search` | toglie una violazione di robots.txt | **costa recall**: 3 titoli su 10 non si trovano più (misura sopra) |
| ~~`data-jtitle` di World come alias~~ | **fatto**: titolo inglese/romaji su ~44% delle 6.864 schede, misurato 14/40 sulla pagina 1 | **zero richieste**: è già nell'HTML del sync |
| ~~`malId` di Saturn e World dalle schede~~ | **fatto**: `parseCardIds` (link MAL + AniList della scheda) e validazione id↔id con AniList (`confirmMalIds`): un id non confermato non si salva | backfill a rate: 300/notte (150 per sito) con stop a 52', schede nuove davanti; 13.043 schede ≈ 45 notti, +~1 richiesta AniList ogni 25 schede |
| JSON-LD `ag-links` di Saturn per `alternateName` | alias sulle schede vecchie (misurato 5/8 utili) | dentro la passata del `malId`: zero richieste in più |
| `lastmod` della sitemap Saturn | rileggere anche le schede *aggiornate*, non solo le nuove | gratis: 6.171/6.179 URL ce l'hanno, va salvato per scheda |
| ~~World `?dub=1`~~ | **superato**: la lingua esatta sta nella scheda già scaricata (`Audio`), non serve una passata sul listing | — |
| ~~campo `dub` di Unity~~ | **fatto**: lingua esatta dove il sito la dichiara. Misura: `dub=1` dà 1.541 schede e **tutte hanno già "(ITA)" nel titolo**, le altre no — quindi il campo è ridondante con l'euristica (+14 etichette su 7.266), ma ora è il dato autorevole | gratis, 2 righe |
| `anilist_id` di Unity | match esatto su AniList | gratis, ma la richiesta non arriva mai come `anilist:`: serve un ponte |
| Saturn `/filter?years=YYYY` | anno su tutte le 6.179 | ~266 richieste — **superato** dal JSON-LD, che dà anno *e* id |



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
