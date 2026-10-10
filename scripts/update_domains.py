#!/usr/bin/env python3
"""
Anime domain updater — AGGIORNA SOLO DOMINI ANIME.

Aggiorna config/domains.json con i domini per:
- animesaturn
- animeunity
- animeworld

Legge i domini da un pastebin e li estrae tramite regex.
Viene eseguito da GitHub workflow ogni 6 ore.
"""
import json, sys, re, urllib.request
from pathlib import Path

PASTEBIN_RAW = 'https://pastebin.com/raw/KgQ4jTy6'
DOMAINS_FILE = Path('config/domains.json')
BACKUP_FILE = Path('config/domains.jsonbk')
ATTENTION_FILE = Path('attenzione.check')

# Chiavi anime-only
KEY_ORDER = ['animesaturn', 'animeunity', 'animeworld']

# Regex per estrarre il dominio anime dal pastebin
KEY_HINTS = {
    'animesaturn': re.compile(r'animesaturn\.[a-z]{2,}'),
    'animeunity': re.compile(r'animeunity\.[a-z]{2,}'),
    'animeworld': re.compile(r'animeworld\.[a-z]{2,}'),
}

HOST_RE = re.compile(r'https?://(www\.)?([^/\s]+)', re.I)

def fetch(url: str) -> str:
    try:
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.read().decode('utf-8', 'replace')
    except Exception as e:
        print(f'[update_domains] fetch fail {url}: {e}', file=sys.stderr)
        return ''

def extract_hosts(text: str):
    hosts = set()
    for m in HOST_RE.finditer(text):
        hosts.add(m.group(2).lower())
    return hosts

def pick_host(hosts, hint_re):
    if not hint_re:
        return None
    cand = [h for h in hosts if hint_re.search(h)]
    if not cand:
        return None
    cand.sort(key=lambda x: (len(x), x))
    return cand[0]

def load_json(path: Path):
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text('utf-8'))
    except Exception:
        return {}

def main():
    paste_txt = fetch(PASTEBIN_RAW)

    if not paste_txt:
        ATTENTION_FILE.write_text('ATTENZIONE: pastebin non raggiungibile. Nessun aggiornamento eseguito.\n', 'utf-8')
        print('Pastebin unreachable -> written attenzione.check')
        return 2

    # Rimuovi attention file se esiste (non più in outage)
    try:
        if ATTENTION_FILE.exists():
            ATTENTION_FILE.unlink()
    except Exception:
        pass

    current = load_json(DOMAINS_FILE)
    if not current:
        # Inizializza con default anime-only
        current = {
            'animesaturn': 'animesaturn.cx',
            'animeunity': 'animeunity.so',
            'animeworld': 'animeworld.ac',
        }

    paste_hosts = extract_hosts(paste_txt)
    updated = dict(current)
    changed = {}

    for key in KEY_ORDER:
        hint_re = KEY_HINTS.get(key)
        if not hint_re:
            continue
        new_host = pick_host(paste_hosts, hint_re)
        if not new_host:
            continue
        old_host = current.get(key)
        if old_host != new_host:
            updated[key] = new_host
            changed[key] = {'old': old_host, 'new': new_host}

    if not changed:
        print('No anime domain changes detected.')
        return 0

    # Backup e scrittura
    BACKUP_FILE.write_text(json.dumps(current, indent=2, ensure_ascii=False) + '\n', 'utf-8')
    DOMAINS_FILE.write_text(json.dumps(updated, indent=2, ensure_ascii=False) + '\n', 'utf-8')

    print('Updated anime domains:', json.dumps(changed, indent=2))
    return 1

if __name__ == '__main__':
    rc = main()
    sys.exit(0)