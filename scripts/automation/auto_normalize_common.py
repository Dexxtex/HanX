"""Logica condivisa per le automazioni di normalizzazione titoli."""
import json
import os
import re
import sys
from pathlib import Path

MARKER = '// << AUTO-INSERT-EXACT >>'
MARKER_RE = re.compile(r'^([ \t]*)' + re.escape(MARKER), re.M)


def _clean_name(value: str, label: str) -> str:
    text = str(value or '').strip()
    if not text:
        raise ValueError(f'{label} vuoto')
    if '\n' in text or '\r' in text:
        raise ValueError(f'{label} deve essere una sola riga')
    return text


def insert_mapping(text: str, key: str, value: str) -> tuple[str, bool]:
    key = _clean_name(key, 'MAL name')
    value = _clean_name(value, 'Titolo provider')

    markers = list(MARKER_RE.finditer(text))
    if len(markers) != 1:
        raise ValueError(f'marker {MARKER} trovato {len(markers)} volte')

    existing = re.compile(rf'^[ \t]*(["\']){re.escape(key)}\1[ \t]*:', re.M)
    if existing.search(text):
        return text, False

    indent = markers[0].group(1)
    line = f'{indent}{json.dumps(key, ensure_ascii=False)}: {json.dumps(value, ensure_ascii=False)},\n'
    marker_start = markers[0].start()
    return text[:marker_start] + line + text[marker_start:], True


def run(provider_path: str, provider_env: str, provider_label: str) -> int:
    try:
        key = _clean_name(os.environ.get('MAL_NAME', ''), 'MAL_NAME')
        value = _clean_name(os.environ.get(provider_env, ''), provider_env)
    except ValueError as error:
        print(f'Error: {error}. Exiting.', file=sys.stderr)
        return 1

    path = Path(provider_path)
    try:
        text = path.read_text(encoding='utf-8')
    except FileNotFoundError:
        print(f'Provider file not found: {provider_path}', file=sys.stderr)
        return 1

    try:
        updated, changed = insert_mapping(text, key, value)
    except ValueError as error:
        print(f'Error: {error}. Exiting.', file=sys.stderr)
        return 1

    if not changed:
        print(f'Mapping already exists for "{key}", nothing to do.')
        return 0

    path.write_text(updated, encoding='utf-8')
    print(f'Added normalization for {provider_label}: "{key}" -> "{value}"')
    return 0
