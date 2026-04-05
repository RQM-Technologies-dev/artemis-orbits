#!/usr/bin/env python3
"""Check required first-data-commit artifacts and report exactly what's missing."""

from pathlib import Path

REQUIRED = [
    Path('data/normalized/artemis-1.json'),
    Path('data/normalized/artemis-1-moon.json'),
    Path('data/normalized/artemis-2.json'),
    Path('data/normalized/artemis-2-moon.json'),
    Path('data/normalized/artemis-3-current.json'),
    Path('data/normalized/artemis-3-moon-current.json'),
    Path('data/normalized/artemis-3-legacy.json'),
    Path('data/normalized/artemis-3-moon-legacy.json'),
    Path('data/normalized/artemis-3-legacy-nrho.json'),
    Path('data/normalized/artemis-3-moon-legacy-nrho.json'),
    Path('data/normalized/artemis-5-current.json'),
    Path('data/normalized/artemis-5-moon-current.json'),
    Path('data/normalized/artemis-5-current-nrho.json'),
    Path('data/normalized/artemis-5-moon-current-nrho.json'),
    Path('data/normalized/artemis-5-legacy.json'),
    Path('data/normalized/artemis-5-moon-legacy.json'),
    Path('data/normalized/artemis-5-legacy-nrho.json'),
    Path('data/normalized/artemis-5-moon-legacy-nrho.json'),
    Path('data/normalized/manifest.json'),
]


def main() -> int:
    missing = [p for p in REQUIRED if not p.exists()]
    present = [p for p in REQUIRED if p.exists()]

    print('First-data artifact check')
    for p in present:
        print(f'  PRESENT: {p}')
    for p in missing:
        print(f'  MISSING: {p}')

    if missing:
        print(f'\nMissing {len(missing)} required file(s). Run npm run data:all when network access is available.')
        return 1

    print('\nAll required normalized artifacts are present.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
