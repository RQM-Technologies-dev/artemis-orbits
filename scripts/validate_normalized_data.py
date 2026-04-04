#!/usr/bin/env python3
"""Validate committed normalized mission/moon/manifest artifacts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

REQUIRED_FILES = [
    'artemis-1.json',
    'artemis-1-moon.json',
    'artemis-2.json',
    'artemis-2-moon.json',
    'manifest.json',
]


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def validate_samples(doc: dict, label: str) -> list[str]:
    errs = []
    segments = doc.get('segments')
    if not isinstance(segments, list) or not segments:
        return [f'{label}: missing segments']

    prev_ms = None
    total = 0
    for seg_idx, seg in enumerate(segments):
        samples = seg.get('samples') or []
        total += len(samples)
        for sample_idx, sample in enumerate(samples):
            epoch_ms = sample.get('epochMs')
            if not isinstance(epoch_ms, int):
                errs.append(f'{label}: segment {seg_idx} sample {sample_idx} has non-int epochMs')
                continue
            if prev_ms is not None and epoch_ms < prev_ms:
                errs.append(f'{label}: samples not globally sorted at segment {seg_idx} sample {sample_idx}')
            prev_ms = epoch_ms

    derived_count = doc.get('derived', {}).get('sampleCount')
    if isinstance(derived_count, int) and derived_count != total:
        errs.append(f'{label}: derived.sampleCount={derived_count} does not match actual={total}')

    return errs


def main() -> int:
    parser = argparse.ArgumentParser(description='Validate normalized artifacts.')
    parser.add_argument('--normalized-dir', default='data/normalized')
    args = parser.parse_args()

    normalized_dir = Path(args.normalized_dir)
    errors: list[str] = []

    for name in REQUIRED_FILES:
        path = normalized_dir / name
        if not path.exists():
            errors.append(f'Missing required file: {path}')

    if errors:
        for err in errors:
            print(f'ERROR: {err}')
        return 1

    mission_ids = ['artemis-1', 'artemis-2']
    for mission_id in mission_ids:
        mission = load_json(normalized_dir / f'{mission_id}.json')
        moon = load_json(normalized_dir / f'{mission_id}-moon.json')

        if mission.get('mission', {}).get('id') != mission_id:
            errors.append(f'{mission_id}.json mission.id mismatch')
        if moon.get('mission', {}).get('id') != mission_id:
            errors.append(f'{mission_id}-moon.json mission.id mismatch')

        errors.extend(validate_samples(mission, f'{mission_id}.json'))
        errors.extend(validate_samples(moon, f'{mission_id}-moon.json'))

    manifest = load_json(normalized_dir / 'manifest.json')
    entries = manifest.get('missions') if isinstance(manifest, dict) else None
    if not isinstance(entries, list):
        errors.append('manifest.json missions is not a list')
    else:
        seen = {entry.get('missionId') for entry in entries if isinstance(entry, dict)}
        for mission_id in mission_ids:
            if mission_id not in seen:
                errors.append(f'manifest.json missing missionId {mission_id}')

    if errors:
        for err in errors:
            print(f'ERROR: {err}')
        return 1

    print('Validation OK: normalized mission, moon, and manifest files are present and consistent.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
