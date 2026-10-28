#!/usr/bin/env python3
"""Auto-normalizzazione AnimeUnity: MAL name -> titolo AnimeUnity."""
import sys

from auto_normalize_common import run

if __name__ == '__main__':
    sys.exit(run(
        'src/providers/animeunity-provider.ts',
        'AU_NAME',
        'AnimeUnity',
    ))
