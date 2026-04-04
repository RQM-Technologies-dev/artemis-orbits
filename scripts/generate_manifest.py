#!/usr/bin/env python3
"""Generate data/normalized/manifest.json from normalized mission outputs."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def build_manifest(normalized_dir: Path) -> dict:
    missions = []
    for mission_file in sorted(normalized_dir.glob('artemis-*.json')):
        if mission_file.name.endswith('-moon.json'):
            continue
        if mission_file.name == 'manifest.json':
            continue

        data = json.loads(mission_file.read_text(encoding='utf-8'))
        mission_id = data.get('mission', {}).get('id') or mission_file.stem
        moon_file = normalized_dir / f'{mission_id}-moon.json'

        missions.append(
            {
                'missionId': mission_id,
                'displayName': data.get('mission', {}).get('displayName', mission_id),
                'status': data.get('mission', {}).get('status'),
                'missionPath': f'./data/normalized/{mission_file.name}',
                'moonPath': f'./data/normalized/{moon_file.name}' if moon_file.exists() else None,
                'eventPath': f'./data/events/{mission_id}.json',
                'sampleCount': data.get('derived', {}).get('sampleCount'),
                'segmentCount': data.get('derived', {}).get('segmentCount'),
                'missionStartUtc': data.get('derived', {}).get('missionStartUtc'),
                'missionStopUtc': data.get('derived', {}).get('missionStopUtc'),
            }
        )

    return {
        'schemaVersion': '1.0.0',
        'kind': 'artemis-normalized-manifest',
        'generatedAtUtc': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
        'missions': missions,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='Generate normalized data manifest.')
    parser.add_argument('--normalized-dir', default='data/normalized')
    parser.add_argument('--output', default='data/normalized/manifest.json')
    args = parser.parse_args()

    normalized_dir = Path(args.normalized_dir)
    normalized_dir.mkdir(parents=True, exist_ok=True)

    manifest = build_manifest(normalized_dir)
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(manifest, indent=2), encoding='utf-8')

    print(f'Wrote manifest with {len(manifest["missions"])} mission(s) to {out_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
