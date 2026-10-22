#!/usr/bin/env python3
"""Auto-normalizzazione AnimeSaturn: MAL name -> titolo AnimeSaturn."""
import sys

from auto_normalize_common import run

if __name__ == '__main__':
    sys.exit(run(
        'src/providers/animesaturn-provider.ts',
        'AS_NAME',
        'AnimeSaturn',
    ))
