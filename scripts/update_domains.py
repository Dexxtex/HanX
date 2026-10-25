#!/usr/bin/env python3
"""
Anime domain updater — AGGIORNA SOLO DOMINI ANIME.

Aggiorna:
- config/domains.json
- config/provider_urls.json

Legge i domini dal pastebin e dai siti ufficiali dei link (animesaturn.me,
animeworlditalia.com), ma applica solo indirizzi realmente raggiungibili.
Se le fonti sono stale o irraggiungibili, prova i domini correnti e i
fallback noti, così AnimeSaturn, AnimeUnity e AnimeWorld non vengono mai
puntati a un host morto.
Eseguito dal workflow GitHub ogni 6 ore.
"""
import json, sys, re, urllib.request
from pathlib import Path
from urllib.parse import urlsplit

PASTEBIN_RAW = 'https://pastebin.com/raw/KgQ4jTy6'
# Fonti ufficiali: elencano solo i domini di streaming validi.
OFFICIAL_SOURCES = {
    'animesaturn': 'https://www.animesaturn.me/',
    'animeworld': 'https://www.animeworlditalia.com/',
}
DOMAINS_FILE = Path('config/domains.json')
PROVIDER_URLS_FILE = Path('config/provider_urls.json')
BACKUP_FILE = Path('config/domains.jsonbk')
ATTENTION_FILE = Path('attenzione.check')

KEY_ORDER = ['animesaturn', 'animeunity', 'animeworld']

KEY_HINTS = {
    'animesaturn': re.compile(r'^(?:animesaturn|animemars)\.[a-z]{2,}$'),
    'animeunity': re.compile(r'^animeunity\.[a-z]{2,}$'),
    'animeworld': re.compile(r'^animeworld\.[a-z]{2,}$'),
}

# Domini che elencano i link ma non sono siti di streaming.
SOURCE_ONLY_HOSTS = {'animesaturn.me', 'animeworlditalia.com'}

# Host raggiungibili ma con un'altra struttura: il provider legge solo il markup
# .co (archivio?title=, records=, info_api) e su animeunity.at non lo trova.
BLOCKED_HOSTS = {'animeunity.at'}

# Fallback usati solo se il pastebin non offre un host raggiungibile.
# Verificati manualmente: animeunity.so è morto, animeunity.co è attivo e senza
# rate-limit sull'IP di casa.
KNOWN_HOSTS = {
    'animesaturn': ['animesaturn.net', 'animemars.org', 'animesaturn.cx', 'animesaturn.cc', 'animesaturn.com'],
    'animeunity': ['animeunity.co', 'animeunity.io'],
    'animeworld': ['animeworld.ac', 'animeworld.so', 'animeworld.tv'],
}

DEFAULT_DOMAINS = {
    'animesaturn': 'animesaturn.net',
    'animeunity': 'animeunity.co',
    'animeworld': 'animeworld.ac',
}

HOST_RE = re.compile(r'https?://(?:www\.)?([a-z0-9.-]+)', re.I)
CHALLENGE_RE = re.compile(
    r'cf-turnstile|Just a moment|__cf_chl_|challenge-platform|'
    r'enable javascript and cookies to continue',
    re.I,
)
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'


def fetch(url: str) -> str:
    try:
        req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.read().decode('utf-8', 'replace')
    except Exception as e:
        print(f'[update_domains] fetch fail {url}: {e}', file=sys.stderr)
        return ''


def normalize_host(value: str) -> str:
    text = str(value or '').strip()
    if not text:
        return ''
    if '://' not in text:
        text = f'https://{text}'
    host = (urlsplit(text).hostname or '').lower().rstrip('.')
    return host[4:] if host.startswith('www.') else host


def extract_hosts(text: str):
    hosts = []
    seen = set()
    for match in HOST_RE.finditer(text):
        host = normalize_host(match.group(1))
        if host and host not in SOURCE_ONLY_HOSTS and host not in seen:
            seen.add(host)
            hosts.append(host)
    return hosts


def candidate_hosts(key: str, paste_hosts, current, official_hosts=()):
    hint = KEY_HINTS[key]
    # Il dominio in uso viene per primo: un mirror raggiungibile ma con un'altra
    # struttura (es. animeunity.at) non deve scavalcare quello che funziona.
    ordered = [current.get(key, '')]
    ordered.extend(host for host in official_hosts if hint.search(host))
    ordered.extend(host for host in paste_hosts if hint.search(host))
    ordered.extend(KNOWN_HOSTS.get(key, []))

    result = []
    seen = set()
    for value in ordered:
        host = normalize_host(value)
        if host and host not in SOURCE_ONLY_HOSTS and host not in BLOCKED_HOSTS and host not in seen:
            seen.add(host)
            result.append(host)
    return result


def probe_host(host: str):
    """Ritorna l'host finale raggiungibile, oppure None."""
    url = f'https://www.{host}'
    try:
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml',
            },
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read(65536).decode('utf-8', 'replace')
            if r.status >= 400 or CHALLENGE_RE.search(body):
                print(f'[update_domains] {host}: HTTP {r.status} o challenge', file=sys.stderr)
                return None
            return normalize_host(r.geturl()) or host
    except Exception as e:
        print(f'[update_domains] {host} non raggiungibile: {e}', file=sys.stderr)
        return None


def choose_host(key: str, candidates):
    hint = KEY_HINTS[key]
    for host in candidates:
        final_host = probe_host(host)
        if final_host and hint.search(final_host):
            print(f'[update_domains] {key}: {host} -> {final_host}')
            return final_host
    return None


def build_provider_urls(domains, existing):
    updated = dict(existing)
    for key in KEY_ORDER:
        host = normalize_host(domains.get(key, ''))
        if host:
            updated[key] = f'https://www.{host}'
    return updated


def load_json(path: Path):
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text('utf-8'))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def write_json(path: Path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', 'utf-8')


def main():
    paste_txt = fetch(PASTEBIN_RAW)
    if not paste_txt:
        print('Pastebin unreachable: uso domini correnti e fallback noti.')

    domains_exists = DOMAINS_FILE.exists()
    current = load_json(DOMAINS_FILE) or dict(DEFAULT_DOMAINS)
    provider_urls = load_json(PROVIDER_URLS_FILE)
    paste_hosts = extract_hosts(paste_txt)
    official_hosts = {
        key: extract_hosts(fetch(url))
        for key, url in OFFICIAL_SOURCES.items()
    }
    updated = dict(current)
    changed = {}
    failures = []

    for key in KEY_ORDER:
        chosen = choose_host(key, candidate_hosts(key, paste_hosts, current, official_hosts.get(key, ())))
        if not chosen:
            failures.append(key)
            continue
        old_host = normalize_host(current.get(key, ''))
        if old_host != chosen:
            updated[key] = chosen
            changed[key] = {'old': current.get(key), 'new': chosen}

    if failures:
        ATTENTION_FILE.write_text(
            'ATTENZIONE: domini non raggiungibili: ' + ', '.join(failures) + '\n',
            'utf-8',
        )
        print('Domini non raggiungibili:', ', '.join(failures), file=sys.stderr)
    elif ATTENTION_FILE.exists():
        try:
            ATTENTION_FILE.unlink()
        except OSError:
            pass

    new_provider_urls = build_provider_urls(updated, provider_urls)
    domains_dirty = not domains_exists or bool(changed)
    provider_urls_dirty = new_provider_urls != provider_urls

    if not domains_dirty and not provider_urls_dirty:
        print('No anime domain changes detected.')
        return 0

    if domains_exists:
        write_json(BACKUP_FILE, current)
    if domains_dirty:
        write_json(DOMAINS_FILE, updated)
    if provider_urls_dirty:
        write_json(PROVIDER_URLS_FILE, new_provider_urls)

    if changed:
        print('Updated anime domains:', json.dumps(changed, indent=2, ensure_ascii=False))
    if provider_urls_dirty:
        print('Updated provider URLs.')
    return 1


if __name__ == '__main__':
    rc = main()
    sys.exit(0)
