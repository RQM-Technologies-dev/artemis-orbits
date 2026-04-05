#!/usr/bin/env python3
"""Print a concise summary for each normalized mission file."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


def to_dt(utc: str | None) -> datetime | None:
    if not utc:
        return None
    return datetime.fromisoformat(utc.replace('Z', '+00:00'))


def fmt_duration(start: datetime | None, stop: datetime | None) -> str:
    if not start or not stop:
        return 'n/a'
    delta = stop - start
    total = int(delta.total_seconds())
    days, rem = divmod(total, 86400)
    hours, rem = divmod(rem, 3600)
    minutes = rem // 60
    return f'{days}d {hours}h {minutes}m'


def main() -> int:
    normalized_dir = Path('data/normalized')
    mission_files = sorted(
        p for p in normalized_dir.glob('artemis-*.json') if not p.name.endswith('-moon.json') and p.name != 'manifest.json'
    )

    if not mission_files:
        print('No normalized mission files found in data/normalized.')
        return 1

    for mission_file in mission_files:
        data = json.loads(mission_file.read_text(encoding='utf-8'))
        mission_id = data.get('mission', {}).get('id', mission_file.stem)
        start_utc = data.get('derived', {}).get('missionStartUtc')
        stop_utc = data.get('derived', {}).get('missionStopUtc')
        segment_count = data.get('derived', {}).get('segmentCount', len(data.get('segments') or []))
        sample_count = data.get('derived', {}).get('sampleCount')

        mission_stub = mission_file.stem
        moon_stub = mission_stub
        if mission_stub.startswith('artemis-3-'):
            moon_stub = mission_stub.replace('artemis-3-', 'artemis-3-moon-', 1)
        elif mission_stub.startswith('artemis-5-'):
            moon_stub = mission_stub.replace('artemis-5-', 'artemis-5-moon-', 1)
        elif mission_stub in ('artemis-1', 'artemis-2'):
            moon_stub = f'{mission_stub}-moon'

        moon_file = normalized_dir / f'{moon_stub}.json'
        event_file = Path('data/events') / f'{mission_stub}.json'

        print(f'{mission_id}')
        print(f'  startUtc: {start_utc}')
        print(f'  stopUtc: {stop_utc}')
        print(f'  duration: {fmt_duration(to_dt(start_utc), to_dt(stop_utc))}')
        print(f'  segmentCount: {segment_count}')
        print(f'  sampleCount: {sample_count}')
        print(f'  moonFile: {"present" if moon_file.exists() else "missing"}')
        print(f'  eventFile: {"present" if event_file.exists() else "missing"}')

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
