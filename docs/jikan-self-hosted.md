# Jikan self-hosted

Stack Jikan completo (API + MongoDB + Redis + Typesense) per uso personale, con le
correzioni che servono a farlo funzionare davvero.

**Perché:** l'API pubblica Jikan è stata dismessa il 1° ottobre 2026. Al suo posto
Tenrai (`https://api.tenrai.org/v1`), compatibile con Jikan ma limitata a 120 richieste
al minuto per IP. Con un'istanza locale il limite sparisce e il catalogo resta
disponibile anche senza rete esterna.

## Cosa cambia in HanX

| Variabile | Dove | Effetto |
|---|---|---|
| `JIKAN_API_BASE` | `docker-compose.yml` (default `http://jikan_rest:8080/v4`) | alimenta **solo** `scripts/build-anime-mapping.mjs`, cioè il catalogo MAL da convertire |
| `JIKAN_NETWORK` | `docker-compose.jikan.yml` (default `jikan_default`) | nome della rete esterna a cui agganciare il container |
| `MAX_RESULTS_PER_PAGE` | `.env` di **Jikan** | tetto al parametro `limit` delle richieste; HanX ne chiede 25, quindi 25 basta |

Attenzione: i metadati anime a runtime **non** passano da `JIKAN_API_BASE`. Quella
strada è hardcoded su Tenrai (`src/providers/anime-core/tenrai-metadata.ts`). Con
questa guida cambia il converter del mapping, non la ricerca per titolo dei provider.

## PHP 8.5: immagine custom

L’immagine ufficiale `jikanme/jikan-rest:latest` è costruita su **PHP 8.1.27**
(`php:8.1.27-bullseye`, pinnato nel `Dockerfile` upstream). Per girare su 8.5
bisogna ricompilare il sorgente: sotto c’è il `Dockerfile` upstream con la base
cambiata e `curl` aggiunto per l’healthcheck.

```bash
cd apps/jikan-rest
git clone --depth 1 https://github.com/jikan-me/jikan-rest.git
```

Salvalo come `apps/jikan-rest/jikan-rest/Dockerfile.php85`, cioè **dentro** il
checkout ma con un nome diverso: sovrascrivere il `Dockerfile` upstream farebbe
conflitto a ogni `git pull`.

```dockerfile
# jikan-rest su PHP 8.5. Build context: il checkout di jikan-me/jikan-rest.
FROM docker.io/spiralscout/roadrunner:2.12.3 AS roadrunner
FROM docker.io/composer:2 AS composer
FROM docker.io/mlocati/php-extension-installer:2.12 AS php-ext-installer

FROM php:8.5-cli-bookworm

COPY --from=composer /usr/bin/composer /usr/bin/composer
COPY --from=php-ext-installer /usr/bin/install-php-extensions /usr/local/bin/

ENV COMPOSER_HOME="/tmp/composer"

RUN set -eux \
    && install-php-extensions intl mbstring mongodb-stable redis opcache sockets pcntl \
    && apt-get update \
    && apt-get install -y --no-install-recommends curl git openssl unzip wget \
    && wget -q "https://github.com/aptible/supercronic/releases/download/v0.1.12/supercronic-linux-$(dpkg --print-architecture)" -O /usr/bin/supercronic \
    && chmod +x /usr/bin/supercronic \
    && mkdir -p /etc/supercronic \
    && echo '*/1 * * * * php /app/artisan schedule:run' > /etc/supercronic/laravel \
    && rm -rf /var/lib/apt/lists/* \
    && printf '\nopcache.enable=1\nopcache.enable_cli=1\nopcache.jit_buffer_size=32M\nopcache.jit=1235\n' >> "${PHP_INI_DIR}/conf.d/docker-php-ext-opcache.ini" \
    && adduser --disabled-password --shell /sbin/nologin --home /nonexistent --no-create-home --uid 10001 --gecos "" jikanapi \
    && mkdir -p /app /var/run/rr \
    && chown -R jikanapi:jikanapi /app /var/run/rr /etc/supercronic/laravel \
    && chmod -R 777 /var/run/rr

COPY --from=roadrunner /usr/bin/rr /usr/bin/rr

USER jikanapi:jikanapi
WORKDIR /app

COPY --chown=jikanapi:jikanapi composer.json composer.lock /app/
# Se il lock upstream rifiuta 8.5, l'unica via è --ignore-platform-req=php
# (a tuo rischio: il vincolo può essere lì per un motivo).
RUN composer install -n --no-dev --no-cache --no-ansi --no-autoloader --no-scripts --prefer-dist

COPY --chown=jikanapi:jikanapi . /app/
RUN set -eux \
    && composer dump-autoload -n --optimize --no-ansi --no-dev \
    && chmod -R a+w storage/ \
    && chmod +x docker-entrypoint.php docker-entrypoint.sh

EXPOSE 8080 2114
HEALTHCHECK CMD curl --fail http://localhost:2114/health?plugin=http || exit 1
ENTRYPOINT ["/app/docker-entrypoint.sh"]
```

Verifica dopo il build:

```bash
docker compose exec jikan_rest php -v          # deve dire 8.5.x
docker compose exec jikan_rest php -m | grep -E 'mongodb|redis|pcntl|sockets'
```

### Se il build si ferma

| Errore | Causa | Rimedio |
|---|---|---|
| `your lock file does not contain a compatible set of packages` | il `composer.lock` upstream fissa una minor di PHP | aggiungi `--ignore-platform-req=php` al `composer install` |
| `mongodb-stable` non compila | estensione non ancora pronta per 8.5 | `pecl install mongodb` esplicito, o torna all’immagine 8.1 |
| deprecation a runtime | Lumen 9 è del 2022 | `LOG_LEVEL=error`; se una deprecation diventa fatal, l’unica via è 8.1 |

Il resto della guida non cambia: percorso, segreti, indici e seed sono identici.

## Stack

Salva come `apps/jikan-rest/compose.yaml`.

Il `name: jikan` non è cosmetico: senza, Compose chiama la rete di default
`jikan-rest_default` e l'overlay di HanX (`name: jikan_default`, `external: true`)
non aggancia niente.

```yaml
name: jikan

secrets:
  jikan_db_username:       { file: ./secrets/db_username.txt }
  jikan_db_password:       { file: ./secrets/db_password.txt }
  jikan_db_admin_username: { file: ./secrets/db_admin_username.txt }
  jikan_db_admin_password: { file: ./secrets/db_admin_password.txt }
  jikan_redis_password:    { file: ./secrets/redis_password.txt }
  jikan_typesense_api_key: { file: ./secrets/typesense_api_key.txt }

services:
  jikan_rest:
    # PHP 8.5: build dal sorgente. Per l'immagine ufficiale (PHP 8.1):
    #   image: docker.io/jikanme/jikan-rest:latest
    build:
      context: ./jikan-rest
      dockerfile: Dockerfile.php85
    image: jikan-rest:php85
    container_name: jikan_rest
    hostname: jikan-rest-api
    user: "10001:10001"
    restart: unless-stopped
    env_file: [ .env.compose ]
    secrets: [ jikan_db_username, jikan_db_password, jikan_redis_password, jikan_typesense_api_key ]
    volumes:
      - ./RepositoryQuery.php:/app/app/Support/RepositoryQuery.php:ro
    expose: [ 8080 ]
    healthcheck:
      test: ["CMD-SHELL", "wget --spider -q 'http://127.0.0.1:2114/health?plugin=http'"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    depends_on:
      jikan_mongo:     { condition: service_healthy }
      jikan_redis:     { condition: service_healthy }
      jikan_typesense: { condition: service_started }

  jikan_mongo:
    image: docker.io/mongo:focal
    container_name: jikan_mongo
    hostname: jikan_mongo
    restart: unless-stopped
    command: "--wiredTigerCacheSizeGB 0.5"
    secrets: [ jikan_db_username, jikan_db_password, jikan_db_admin_username, jikan_db_admin_password ]
    environment:
      MONGO_INITDB_ROOT_USERNAME_FILE: /run/secrets/jikan_db_admin_username
      MONGO_INITDB_ROOT_PASSWORD_FILE: /run/secrets/jikan_db_admin_password
      MONGO_INITDB_DATABASE: jikan_admin
    volumes:
      - ${DOCKER_DATA_DIR}/jikan-rest/mongo:/data/db
      - ./mongo-init.js:/docker-entrypoint-initdb.d/mongo-init.js:ro
    healthcheck:
      test: ["CMD-SHELL", "mongosh mongodb://localhost:27017 --quiet --eval 'db.runCommand(\"ping\").ok'"]
      interval: 30s
      timeout: 10s
      retries: 5

  jikan_redis:
    image: docker.io/redis:6-alpine
    container_name: jikan_redis
    hostname: jikan_redis
    restart: unless-stopped
    secrets: [ jikan_redis_password ]
    command: ["/bin/sh", "-c", "redis-server --requirepass \"$$(cat /run/secrets/jikan_redis_password)\" --appendonly yes"]
    volumes:
      - ${DOCKER_DATA_DIR}/jikan-rest/redis:/data
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a \"$$(cat /run/secrets/jikan_redis_password)\" ping | grep -q PONG"]
      interval: 10s
      timeout: 5s
      retries: 5

  jikan_typesense:
    image: docker.io/typesense/typesense:0.24.1
    container_name: jikan_typesense
    hostname: jikan_typesense
    restart: unless-stopped
    entrypoint: /bin/sh
    secrets: [ jikan_typesense_api_key ]
    command: ["-c", "TYPESENSE_API_KEY=\"$$(cat /run/secrets/jikan_typesense_api_key)\" /opt/typesense-server --data-dir /data"]
    volumes:
      - ${DOCKER_DATA_DIR}/jikan-rest/typesense:/data
```

`DOCKER_DATA_DIR` deve esistere, altrimenti Compose interpola stringa vuota e i dati
finiscono in `/jikan-rest/...` **dentro** il container, persi al primo ricrea:

```bash
echo "DOCKER_DATA_DIR=/srv/docker" >> .env   # o dove tieni i volumi
```

> `docker.io/mongo:focal` è l'alias della variante Ubuntu 20.04: oggi risolve a
> MongoDB 5.0.x, **EOL da ottobre 2024**. È così anche nel compose ufficiale di
> jikan-rest, quindi va bene per compatibilità — ma non è un database supportato.

## `apps/jikan-rest/.env.compose`

Le differenze rispetto all'upstream sono `APP_URL` (obbligatoria: gli indexer si
auto-chiamano) e `MAX_RESULTS_PER_PAGE=50` (facoltativa).

```env
APP_DEBUG=false
LOG_LEVEL=info
APP_ENV=production
# Gli indexer si auto-chiamano: deve puntare alla porta di RoadRunner (8080), non alla 80.
APP_URL=http://127.0.0.1:8080
CACHING=true
CACHE_DRIVER=redis
REDIS_HOST=jikan_redis
REDIS_PASSWORD__FILE=/run/secrets/jikan_redis_password
DB_CONNECTION=mongodb
DB_HOST=jikan_mongo
DB_DATABASE=jikan
DB_USERNAME__FILE=/run/secrets/jikan_db_username
DB_ADMIN__FILE=/run/secrets/jikan_db_username
DB_PASSWORD__FILE=/run/secrets/jikan_db_password
SCOUT_DRIVER=typesense
SCOUT_QUEUE=false
TYPESENSE_HOST=jikan_typesense
TYPESENSE_PORT=8108
TYPESENSE_API_KEY__FILE=/run/secrets/jikan_typesense_api_key
CORS_MIDDLEWARE=true
MICROCACHING=true
MICROCACHING_EXPIRE=60
MAX_RESULTS_PER_PAGE=50
```

## `apps/jikan-rest/mongo-init.js`

La migration `2022_12_04_210448_squash.php` non crea gli indici in modo affidabile.
Costruirli qui significa che esistono prima del primo inserimento: `mal_id` resta
unico e le query non degradano a collection scan.

```js
const username = fs.readFileSync('/run/secrets/jikan_db_username', 'utf8').trim();
const password = fs.readFileSync('/run/secrets/jikan_db_password', 'utf8').trim();
const roles = [{ role: 'readWrite', db: 'jikan' }];

db.getSiblingDB('admin').createUser({ user: username, pwd: password, roles });
const jikan = db.getSiblingDB('jikan');
jikan.createUser({ user: username, pwd: password, roles });

const fields = [
  'aired', 'airing', 'episodes', 'members', 'favorites', 'popularity', 'rank',
  'rating', 'score', 'scored_by', 'status', 'type', 'source',
  'title', 'title_english', 'title_japanese', 'title_synonyms',
  'demographics.mal_id', 'explicit_genres.mal_id', 'genres.mal_id',
  'licensors.mal_id', 'producers.mal_id', 'studios.mal_id', 'themes.mal_id',
  'aired.from', 'aired.to',
];
fields.forEach((field) => jikan.anime.createIndex({ [field]: 1 }, { name: field }));
jikan.anime.createIndex({ mal_id: 1 }, { name: 'mal_id', unique: true });
jikan.anime.createIndex(
  { title: 'text', title_japanese: 'text' },
  { name: 'search', weights: { title: 50, title_japanese: 5 } }
);
print(`anime indexes created: ${jikan.anime.getIndexes().length}`);
```

Gira solo a data directory vuoto, quindi copre le stack nuove. Quelle esistenti
hanno bisogno della [passata manuale](#mongodb-indici) più sotto.

## Patch `RepositoryQuery.php` (obbligatoria)

`queryable()` memoizza il builder su un repository singleton, e i worker RoadRunner
sopravvivono alle richieste: un worker somma gli `where` di tutto ciò che ha servito.
Il sintomo è identico URL con conteggi diversi, e `sfw=true` che non restituisce
niente. Salva come `apps/jikan-rest/RepositoryQuery.php`:

```php
<?php

declare(strict_types=1);

namespace App\Support;

use App\Contracts\RepositoryQuery as RepositoryQueryContract;
use Closure;
use Illuminate\Contracts\Database\Query\Builder;
use Illuminate\Support\Collection;
use Laravel\Scout\Builder as ScoutBuilder;

class RepositoryQuery extends RepositoryQueryBase implements RepositoryQueryContract
{
    #[\Override]
    public function filter(Collection $params): Builder|ScoutBuilder
    {
        // queryable() memoizza il builder. I repository sono singleton che vivono più
        // a lungo della request sotto RoadRunner, quindi l'istanza memoizzata accumula
        // i where di tutte le richieste precedenti (genere A AND genere B AND ... => 0).
        // Si riparte sempre da un builder nuovo.
        return $this->queryable(true)->filter($params);
    }

    #[\Override]
    public function search(string $keywords, ?Closure $callback = null): ScoutBuilder
    {
        return $this->searchable($keywords, $callback, true);
    }

    #[\Override]
    public function where(string $key, mixed $value): Builder
    {
        return $this->queryable(true)->where($key, $value);
    }
}
```

Gli import sono tutti classi già presenti nell’immagine (`App\Contracts\RepositoryQuery`,
`App\Support\RepositoryQueryBase`, `Illuminate\Contracts\Database\Query\Builder`,
`Illuminate\Support\Collection`, `Laravel\Scout\Builder`): nessun `composer require`,
nessuna dipendenza nuova. Il file è identico a quello upstream tranne `queryable(true)`
in `filter()` e `where()`: quando aggiorni jikan-rest, fai il diff con l’originale
invece di ricopiare questa versione.

Il file è scritto per **PHP 8.5** (l’immagine custom qui sopra):
`declare(strict_types=1)` rende il file strict, `#[\Override]` (8.3+) fa fallire
l’avvio se uno dei tre metodi smette di implementare il contratto — cioè se una
futura versione di jikan-rest rinominasse o spostasse la firma. Se torni
all’immagine ufficiale (PHP 8.1), **togli i tre attributi**: lì sarebbero
silenziosamente ignorati.

Crea **sia** questo file sia `mongo-init.js` prima del primo `docker compose up -d`:
se mancano, Docker crea una directory al posto del file e il mount fallisce.

## Segreti

```bash
cd apps/jikan-rest && mkdir -p secrets
echo -n "jikan"        > secrets/db_username.txt
echo -n "jikanadmin"   > secrets/db_admin_username.txt
openssl rand -hex 24 | tr -d '\n' > secrets/db_password.txt
openssl rand -hex 24 | tr -d '\n' > secrets/db_admin_password.txt
openssl rand -hex 24 | tr -d '\n' > secrets/redis_password.txt
openssl rand -hex 24 | tr -d '\n' > secrets/typesense_api_key.txt
chmod 644 secrets/*.txt   # l'app gira come 10001, non come root
```

Poi `docker compose up -d --build`: il primo build compila PHP 8.5, le estensioni
e le dipendenze Composer (5–10 minuti). Verifica:

```bash
docker compose ps
curl -s http://127.0.0.1:8080/v4/anime/1 | head -c 200
```

`/v4/anime/{id}` funziona subito perché fa scraping di MAL al volo. **Search,
`seasons`, `top` e i cataloghi per genere no**: leggono dal database Jikan, che nasce
vuoto.

## Seed

```bash
# metadati veloci
docker exec jikan_rest php artisan indexer:genres
docker exec jikan_rest php artisan indexer:producers
docker exec jikan_rest php artisan indexer:anime-current-season
docker exec jikan_rest php artisan indexer:anime-schedule

# catalogo completo (~30k anime, ore; --delay è in secondi, default 3)
docker exec -d jikan_rest sh -c 'php artisan indexer:anime --delay=1 >> /tmp/indexer-anime.log 2>&1'
```

Se il run si interrompe, riprende con `--resume`; con `--failed` ritenta solo le entry
fallite:

```bash
docker exec jikan_rest php artisan indexer:anime --delay=1 --resume
```

Lo stato di resume sta in `/app/storage`, che **non è montato**: sopravvive a un
`restart` del container, non a un `compose down` o a una ricreazione. In quel caso si
riparte da zero (o da `--index=N`).

`--delay=1` riduce il tempo ma aumenta il rischio che MAL limiti il tuo IP. Il
container ha già un proprio scheduler (supercronic) che tiene i dati freschi dopo il
seed iniziale.

## Ricerca (Typesense)

Jikan divide la ricerca in due: Typesense risolve `?q=`, MongoDB applica i filtri
(`genres`, `producers`, `sfw`, `min_score`, date...). La stack qui sopra è già
cablata così e non va patchata.

L'alternativa `SCOUT_DRIVER=null` manda tutto su `MongoSearchService`: `$text` indicizza
token interi e non tollera refusi, quindi `999` non trova *Lv999 no Murabito*. Non
vale la pena.

### Import

Scout tiene Typesense aggiornato tramite gli observer; il driver `null` li disattiva.
Una stack che ha girato con la ricerca spenta ha un indice vuoto o fermo e va
reimportata una volta:

```bash
for m in Anime Manga Character Person Club Magazine Producers; do
  docker exec jikan_rest php artisan scout:import "App\\$m"
done
```

È un'operazione una tantum: qualche minuto, non un job ricorrente. Dopo, gli observer
bastano.

**Non creare gli schemi a mano.** Ogni modello dichiara il proprio in
`getCollectionSchema()` (vedi `app/Anime.php`), completo di `infix: true`: è quello
che permette di trovare *Lv999* cercando `999`. Uno schema artigianale senza `infix`
crea una collection che risponde, ma non trova le sottostringhe — cioè disattiva
proprio la funzione per cui Typesense è lì. Se una collection è stata creata male,
cancellala e reimporta:

```bash
docker exec jikan_rest php -r '
$k = trim(file_get_contents("/run/secrets/jikan_typesense_api_key"));
$c = curl_init("http://jikan_typesense:8108/collections/anime_index");
curl_setopt_array($c, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => "DELETE",
  CURLOPT_HTTPHEADER => ["X-TYPESENSE-API-KEY: $k"]]);
curl_exec($c);
echo curl_getinfo($c, CURLINFO_HTTP_CODE), PHP_EOL;'
docker exec jikan_rest php artisan scout:import "App\\Anime"
docker restart jikan_rest
```

Il restart serve: il descriptor della collection è in cache per worker RoadRunner,
quindi i worker avviati prima del nuovo indice continuano a rispondere con quello
vecchio.

### Ordinamento

`TYPESENSE_TEXT_MATCH_BUCKETS` (default **1**) raggruppa i risultati in fasce di
rilevanza prima dell'ordinamento secondario (`popularity`, poi `rank`). Con `1` tutti
i match finiscono nella stessa fascia, quindi **decide la popolarità**. Alzandolo
distingui meglio la pertinenza e l'ordine segue di più il testo cercato.

## MongoDB: indici

Le stack nuove li hanno da `mongo-init.js`. Le altre rischiano un solo `_id_`, cioè
collection scan e richieste per genere che vanno in timeout a catalogo pieno.
`mongo-init.js` non le sistema: gira solo su data directory vuota. Controlla:

```bash
docker exec jikan_mongo mongosh "mongodb://<admin_user>:<admin_pass>@localhost/admin" \
  --quiet --eval 'print(db.getSiblingDB("jikan").anime.getIndexes().length)'
```

Deve dire **29** (26 campi + `mal_id` + `search` + `_id_`). Se dice 1, salva come
`apps/jikan-rest/jikan-indexes.js` e lancialo: è idempotente.

```js
const jikan = db.getSiblingDB('jikan');
const fields = [
  'aired', 'airing', 'episodes', 'members', 'favorites', 'popularity', 'rank',
  'rating', 'score', 'scored_by', 'status', 'type', 'source',
  'title', 'title_english', 'title_japanese', 'title_synonyms',
  'demographics.mal_id', 'explicit_genres.mal_id', 'genres.mal_id',
  'licensors.mal_id', 'producers.mal_id', 'studios.mal_id', 'themes.mal_id',
  'aired.from', 'aired.to',
];
fields.forEach((field) => jikan.anime.createIndex({ [field]: 1 }, { name: field }));
try {
  jikan.anime.createIndex({ mal_id: 1 }, { name: 'mal_id', unique: true });
} catch (error) {
  print(`mal_id index failed, vedi la deduplica sotto: ${error.codeName}`);
}
jikan.anime.createIndex(
  { title: 'text', title_japanese: 'text' },
  { name: 'search', weights: { title: 50, title_japanese: 5 } }
);
print(`anime indexes: ${jikan.anime.getIndexes().length}`);
```

```bash
cd apps/jikan-rest
docker exec -i jikan_mongo mongosh \
  "mongodb://$(cat secrets/db_admin_username.txt):$(cat secrets/db_admin_password.txt)@localhost/admin" \
  --quiet < jikan-indexes.js
```

Se stampa 28 e la riga `mal_id` ha dato `DuplicateKey`, l'indexer ha salvato lo stesso
anime due volte (può farlo finché non esiste l'indice unico). Salva come
`jikan-dedupe.js`, tienilo e rilancia l'indice:

```js
const jikan = db.getSiblingDB('jikan');
jikan.anime.aggregate([
  { $group: { _id: '$mal_id', ids: { $push: '$_id' }, n: { $sum: 1 } } },
  { $match: { n: { $gt: 1 } } }
], { allowDiskUse: true }).forEach((group) => {
  group.ids.slice(1).forEach((id) => jikan.anime.deleteOne({ _id: id }));
  print(`mal_id ${group._id}: removed ${group.n - 1}`);
});
jikan.anime.createIndex({ mal_id: 1 }, { name: 'mal_id', unique: true });
print(`anime indexes: ${jikan.anime.getIndexes().length}`);
```

## Worker RoadRunner

Il server accumula CPU/memoria nel tempo. Per riciclare i worker senza restart,
monta un `.rr.yaml` su `/app/.rr.yaml` che aggiunge: `queue:work --max-time=3600
--max-jobs=1000 --memory=256`, `supervisor.ttl: 3600s` nella pool HTTP e un
`num_workers` esplicito.

## Problemi noti

| Sintomo | Causa |
|---|---|
| `docker compose` non trova `jikan_default` da HanX | manca `name: jikan` nel compose |
| Healthcheck sempre unhealthy | segreti non leggibili: `chmod 644 secrets/*.txt` |
| Conteggi diversi per lo stesso URL, `sfw=true` vuoto | manca la patch `RepositoryQuery.php` |
| Search 500 | collection Typesense creata con schema sbagliato: cancellala e reimporta |
| `?q=999` non trova *Lv999* | `SCOUT_DRIVER=null`, oppure schema senza `infix` |
| Query per genere lentissime | indici Mongo assenti: devono essere 29 |
| Porta 8080 già occupata | lo stack usa `expose`, non `ports`: nessun conflitto atteso |
| `php -v` dice ancora 8.1 | il servizio usa `image:` invece di `build:` | ripristina il blocco `build` del compose |
| build fermo su `composer install` | il lock upstream non accetta 8.5 | vedi “Se il build si ferma” |

---

Verificato contro `jikan-me/jikan-rest@master` il 24/10/2026.
