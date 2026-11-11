#!/bin/sh
# Finisce il backfill dei malId a blocchi, salvando il catalogo dopo ognuno.
#
# Perché a blocchi: `sync-catalog.ts --enrich-only` scrive il catalogo **solo
# alla fine**, quindi una run interrotta (deadline, ssh che cade, 403) perde
# tutto il lavoro fatto. Qui ogni blocco è piccolo e il risultato resta su disco:
# il blocco dopo riparte da lì.
#
# Il pacing è quello dello script (1 s globale, una richiesta alla volta su tutti
# e tre i siti): un blocco da 400 schede sono ~7 minuti. 403 ferma tutto.
#
# Uso (dalla radice del repo, con `data/catalogs.json` già presente):
#   scripts/ops/finish-malids.sh              # 8 blocchi, nessun push
#   scripts/ops/finish-malids.sh 3            # 3 blocchi
#   GITHUB_TOKEN=... scripts/ops/finish-malids.sh   # pubblica dopo ogni blocco
#
# Senza GITHUB_TOKEN il risultato resta in `data/`: si pubblica da dove c'è la
# credenziale (il branch `data` accetta solo force-push autenticato).
set -eu

BLOCKS=${1:-8}
PER_BLOCK=${PER_BLOCK:-400}
REPO=${GITHUB_REPO:-Dexxtex/HanX}
IMAGE=${IMAGE:-node:26-alpine}

cd "$(dirname "$0")/../.."

# Conteggio delle schede senza malId: python3 sul server, node nel container.
count_missing() {
  python3 -c "import json;d=json.load(open('data/catalogs.json'));a=[e for v in d['sites'].values() for e in v];print(sum(1 for e in a if not e.get('malId')))" 2>/dev/null ||
    docker run --rm -v "$PWD:/app" -w /app "$IMAGE" node -e \
      "const d=require('/app/data/catalogs.json');const a=Object.values(d.sites).flat();console.log(a.filter(e=>!e.malId).length)"
}

publish() {
  [ -n "${GITHUB_TOKEN:-}" ] || { echo "  (nessun GITHUB_TOKEN: non pubblico)"; return 0; }
  work=$(mktemp -d)
  cp data/catalogs.json data/catalog-titles.json "$work"/
  git show origin/data:last-sync.txt > "$work/last-sync.txt" 2>/dev/null || rm -f "$work/last-sync.txt"
  (
    cd "$work"
    git init -q -b data
    git add catalogs.json catalog-titles.json
    [ -s last-sync.txt ] && git add last-sync.txt
    git -c user.name='github-actions[bot]' \
        -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
        commit -qm "chore(catalog): backfill malId"
    git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO}.git"
    git push -q -f origin data
  )
  rm -rf "$work"
  echo "  pubblicato sul branch data"
}

i=0
while [ "$i" -lt "$BLOCKS" ]; do
  i=$((i + 1))
  before=$(count_missing)
  echo "[$(date +%H:%M)] blocco $i/$BLOCKS — schede senza malId: $before"
  [ "$before" -eq 0 ] && { echo "niente da fare"; break; }

  # Una run per blocco: scrive il catalogo alla fine, quindi il blocco dopo
  # riparte dalle schede che restano.
  if ! docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
      -e CATALOG_INTERVAL_MS=1000 \
      -e CATALOG_MALID_MAX_REQUESTS="$PER_BLOCK" \
      -e CATALOG_MALID_DEADLINE_MIN=20 \
      ${CATALOG_PROXY:+-e CATALOG_PROXY="$CATALOG_PROXY"} \
      -v "$PWD:/app" -w /app "$IMAGE" \
      sh -c 'export PATH=/tmp/pnpm/bin:$PATH && node --import tsx scripts/sync/sync-catalog.ts --enrich-only'; then
    echo "[$(date +%H:%M)] blocco $i fallito (403/WAF o errore): stop"
    exit 1
  fi

  after=$(count_missing)
  echo "[$(date +%H:%M)] dopo il blocco $i: $after senza malId (chiusi $((before - after)))"
  if [ "$after" -ge "$before" ]; then
    echo "nessun progresso: le restanti non hanno un malId ricavabile dalla pagina"
    break
  fi
  publish
done

echo "fine: $(count_missing) schede senza malId"
