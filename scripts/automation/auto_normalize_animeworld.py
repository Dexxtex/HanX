#!/usr/bin/env python3
"""Auto-normalizzazione AnimeWorld: MAL name -> titolo AnimeWorld."""
import sys

from auto_normalize_common import run

if __name__ == '__main__':
    sys.exit(run(
        'src/providers/animeworld-provider.ts',
        'AW_NAME',
        'AnimeWorld',
    ))
