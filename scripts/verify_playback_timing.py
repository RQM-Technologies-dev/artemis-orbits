#!/usr/bin/env python3
"""Generate playback timing verification report(s) for normalized missions."""

from __future__ import annotations

import argparse
import json
import statistics
from datetime import datetime, timezone
from pathlib import Path


def flatten_samples(mission: dict) -> list[dict]:
    segs = mission.get('segments') or []
    flat = []
    for seg in segs:
        flat.extend(seg.get('samples') or [])
    flat.sort(key=lambda s: s.get('epochMs', 0))
    return flat


def nearest_sample(samples: list[dict], event_ms: int) -> tuple[int | None, int | None]:
    if not samples:
        return None, None
    nearest = min(samples, key=lambda s: abs(s['epochMs'] - event_ms))
    return nearest.get('epochMs'), event_ms - nearest.get('epochMs')


def support_window(samples: list[dict], event_ms: int) -> dict | None:
    if len(samples) < 2:
        return None
    earlier = None
    later = None
    for sample in samples:
        ts = sample.get('epochMs')
        if ts is None:
            continue
        if ts <= event_ms:
            earlier = ts
        if ts >= event_ms and later is None:
            later = ts
    if earlier is None:
        earlier = samples[0].get('epochMs')
    if later is None:
        later = samples[-1].get('epochMs')
    return {
        'supportStartEpochMs': earlier,
        'supportStopEpochMs': later,
        'insideSupportWindow': bool(earlier <= event_ms <= later),
    }


def run_check(mission_path: Path, events_path: Path | None, reports_dir: Path) -> tuple[dict, Path]:
    mission = json.loads(mission_path.read_text(encoding='utf-8'))
    mission_id = mission_path.stem
    base_mission_id = mission.get('mission', {}).get('id', mission_id)

    samples = flatten_samples(mission)
    segment_count = len(mission.get('segments') or [])
    sample_count = len(samples)

    start_ms = samples[0]['epochMs'] if samples else None
    stop_ms = samples[-1]['epochMs'] if samples else None
    start_utc = samples[0]['epochUtc'] if samples else None
    stop_utc = samples[-1]['epochUtc'] if samples else None

    steps = []
    for i in range(1, sample_count):
        dt_s = (samples[i]['epochMs'] - samples[i - 1]['epochMs']) / 1000.0
        if dt_s > 0:
            steps.append(dt_s)

    events = []
    warnings = []
    if events_path and events_path.exists():
        raw_events = json.loads(events_path.read_text(encoding='utf-8'))
        for idx, ev in enumerate(raw_events):
            ev_id = ev.get('id', f'event-{idx}')
            epoch_utc = ev.get('epochUtc')
            event_ms = int(datetime.fromisoformat(epoch_utc.replace('Z', '+00:00')).timestamp() * 1000) if epoch_utc else None
            in_range = bool(start_ms is not None and stop_ms is not None and event_ms is not None and start_ms <= event_ms <= stop_ms)

            near_ms, offset_ms = nearest_sample(samples, event_ms) if event_ms is not None else (None, None)
            window = support_window(samples, event_ms) if event_ms is not None else None

            events.append(
                {
                    'id': ev_id,
                    'label': ev.get('label'),
                    'epochUtc': epoch_utc,
                    'verified': bool(ev.get('verified', False)),
                    'rangeStatus': 'inside-range' if in_range else 'out-of-range',
                    'nearestSampleEpochMs': near_ms,
                    'nearestSampleOffsetMs': offset_ms,
                    'interpolationSupport': window,
                }
            )
            if not in_range and bool(ev.get('verified', False)):
                warnings.append(f'Verified event {ev_id} is outside mission time window')
    else:
        warnings.append('Event file missing; mission-to-event timing check skipped.')

    report = {
        'missionId': mission_id,
        'baseMissionId': base_mission_id,
        'missionPath': str(mission_path),
        'eventsPath': str(events_path) if events_path else None,
        'timeWindow': {
            'startUtc': start_utc,
            'stopUtc': stop_utc,
            'startEpochMs': start_ms,
            'stopEpochMs': stop_ms,
            'durationSeconds': ((stop_ms - start_ms) / 1000.0) if start_ms is not None and stop_ms is not None else None,
        },
        'sampleCount': sample_count,
        'segmentCount': segment_count,
        'nominalStepSecondsMedian': round(statistics.median(steps), 3) if steps else None,
        'eventChecks': events,
        'warnings': warnings,
        'generatedAtUtc': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
    }

    reports_dir.mkdir(parents=True, exist_ok=True)
    out_path = reports_dir / f'{mission_id}-playback-check.json'
    out_path.write_text(json.dumps(report, indent=2), encoding='utf-8')
    return report, out_path


def print_report(report: dict, out_path: Path) -> None:
    print(f"Mission: {report['missionId']}")
    tw = report['timeWindow']
    print(f"  Window: {tw['startUtc']} -> {tw['stopUtc']}")
    print(f"  Samples: {report['sampleCount']} | Segments: {report['segmentCount']} | Median step: {report['nominalStepSecondsMedian']} s")
    if report['eventChecks']:
        for ev in report['eventChecks']:
            print(f"  Event {ev['id']}: {ev['rangeStatus']}, nearest offset {ev['nearestSampleOffsetMs']} ms")
    for warning in report['warnings']:
        print(f'  WARNING: {warning}')
    print(f'  Report: {out_path}')


def default_jobs(normalized_dir: Path) -> list[tuple[Path, Path]]:
    jobs = []
    for mission_id in ('artemis-1', 'artemis-2', 'artemis-3-current', 'artemis-3-legacy', 'artemis-3-legacy-nrho'):
        mission_path = normalized_dir / f'{mission_id}.json'
        events_path = Path('data/events') / f'{mission_id}.json'
        jobs.append((mission_path, events_path))
    return jobs


def main() -> int:
    parser = argparse.ArgumentParser(description='Verify playback timing against mission/event data.')
    parser.add_argument('--mission', help='Path to one normalized mission JSON file')
    parser.add_argument('--events', help='Optional path to events JSON for --mission')
    parser.add_argument('--reports-dir', default='reports')
    parser.add_argument('--normalized-dir', default='data/normalized')
    parser.add_argument(
        '--fail-on-issues',
        action='store_true',
        help='Return non-zero if any warnings are detected.',
    )
    args = parser.parse_args()

    reports_dir = Path(args.reports_dir)

    if args.mission:
        mission_path = Path(args.mission)
        events_path = Path(args.events) if args.events else None
        if not mission_path.exists():
            print(f'ERROR: mission file not found: {mission_path}')
            return 1
        report, out_path = run_check(mission_path, events_path, reports_dir)
        print_report(report, out_path)
        if args.fail_on_issues and report.get('warnings'):
            return 1
        return 0

    jobs = default_jobs(Path(args.normalized_dir))
    rc = 0
    for mission_path, events_path in jobs:
        if not mission_path.exists():
            print(f'WARNING: skipping missing mission file {mission_path}')
            rc = 1
            continue
        report, out_path = run_check(mission_path, events_path, reports_dir)
        print_report(report, out_path)
        if args.fail_on_issues and report.get('warnings'):
            rc = 1
    return rc


if __name__ == '__main__':
    raise SystemExit(main())
