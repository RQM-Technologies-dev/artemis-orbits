#!/usr/bin/env python3
"""
fetch_moon_vectors.py
=====================
Query the JPL Horizons API for Moon (target 301) position/velocity
vectors over the mission window defined in a normalized mission JSON
file, then write a compatible normalized JSON output.

The output uses the same sample schema as normalize_oem.py:
  { epochUtc, epochMs, positionKm, velocityKmS }

so the artemis-orbits viewer can load both files with the same
dataLoader.js code.

Usage:
  python3 scripts/fetch_moon_vectors.py \\
    --input  data/normalized/artemis-2.json \\
    --output data/normalized/artemis-2-moon.json

JPL Horizons API reference:
  https://ssd-api.jpl.nasa.gov/doc/horizons.html
"""

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


# ── Constants ─────────────────────────────────────────────────────

HORIZONS_API = 'https://ssd.jpl.nasa.gov/api/horizons.api'

TARGET  = '301'          # Moon
CENTER  = '500@399'      # Geocentre (Earth body centre)
REF_FRAME = 'J2000'
VEC_TABLE = '2'          # state vectors: X Y Z VX VY VZ
UNITS   = 'KM-S'
OUT_UNITS = 'KM-S'


# ── Epoch helpers ─────────────────────────────────────────────────

def _utc_iso_to_horizons(utc_z: str) -> str:
    """
    Convert '2026-04-02T03:07:49.583Z' → "2026-Apr-02 03:07:49.583"
    which is the format Horizons accepts.
    """
    # Strip trailing Z, parse
    s = utc_z.rstrip('Z')
    for fmt in ('%Y-%m-%dT%H:%M:%S.%f', '%Y-%m-%dT%H:%M:%S'):
        try:
            dt = datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
            return dt.strftime('%Y-%b-%d %H:%M:%S.') + f'{dt.microsecond // 1000:03d}'
        except ValueError:
            continue
    raise ValueError(f"Cannot convert epoch: {utc_z!r}")


def _parse_horizons_epoch(token: str) -> tuple[str, int]:
    """
    Parse a Horizons epoch token like '2026-Apr-02 03:07:49.5830'
    or '2026-Apr-02 03:07:49.583' into (utcIsoZ, epochMs).
    """
    token = token.strip()
    for fmt in (
        '%Y-%b-%d %H:%M:%S.%f',
        '%Y-%b-%d %H:%M:%S',
        '%Y-%m-%d %H:%M:%S.%f',
        '%Y-%m-%d %H:%M:%S',
    ):
        try:
            dt = datetime.strptime(token, fmt).replace(tzinfo=timezone.utc)
            ms = dt.microsecond // 1000
            utc_z = dt.strftime('%Y-%m-%dT%H:%M:%S.') + f'{ms:03d}Z'
            epoch_ms = int(dt.timestamp() * 1000)
            return utc_z, epoch_ms
        except ValueError:
            continue
    raise ValueError(f"Cannot parse Horizons epoch token: {token!r}")


# ── Horizons query ────────────────────────────────────────────────

def query_horizons(start_utc: str, stop_utc: str, step: str = '4h') -> str:
    """
    Query the Horizons API and return the raw response text.

    Parameters
    ----------
    start_utc : str  – ISO-8601 UTC start (with Z)
    stop_utc  : str  – ISO-8601 UTC stop  (with Z)
    step      : str  – step size, e.g. '4h', '1d', '240m'
    """
    start_h = _utc_iso_to_horizons(start_utc)
    stop_h  = _utc_iso_to_horizons(stop_utc)

    params = {
        'format':         'text',
        'COMMAND':        f"'{TARGET}'",
        'OBJ_DATA':       'NO',
        'MAKE_EPHEM':     'YES',
        'EPHEM_TYPE':     'VECTORS',
        'CENTER':         CENTER,
        'REF_FRAME':      REF_FRAME,
        'START_TIME':     f"'{start_h}'",
        'STOP_TIME':      f"'{stop_h}'",
        'STEP_SIZE':      f"'{step}'",
        'VEC_TABLE':      VEC_TABLE,
        'VEC_CORR':       'NONE',
        'OUT_UNITS':      OUT_UNITS,
        'VEC_LABELS':     'YES',
        'CSV_FORMAT':     'YES',
    }

    url = HORIZONS_API + '?' + urllib.parse.urlencode(params)
    print(f'Querying JPL Horizons…\n  {url}')

    try:
        with urllib.request.urlopen(url, timeout=60) as resp:
            return resp.read().decode('utf-8')
    except Exception as exc:
        raise RuntimeError(f'Horizons request failed: {exc}') from exc


# ── Response parser ───────────────────────────────────────────────

def parse_horizons_response(text: str) -> list[dict]:
    """
    Parse the CSV vector table from a Horizons text response.

    Returns a list of sample dicts:
      { epochUtc, epochMs, positionKm, velocityKmS }
    """
    # Find the $$SOE … $$EOE block
    soe = text.find('$$SOE')
    eoe = text.find('$$EOE')
    if soe == -1 or eoe == -1:
        # Check for error messages
        if 'No ephemeris for target' in text or 'ERROR' in text:
            err_line = next(
                (l for l in text.splitlines() if 'ERROR' in l or 'No ephemeris' in l),
                'Unknown Horizons error'
            )
            raise ValueError(f'Horizons error: {err_line}')
        raise ValueError('Could not find $$SOE/$$EOE markers in Horizons response.')

    data_block = text[soe + 5:eoe].strip()
    samples = []

    for line in data_block.splitlines():
        line = line.strip()
        if not line or line.startswith('*'):
            continue

        # CSV format: JDTDB, Calendar Date (TDB), X, Y, Z, VX, VY, VZ
        parts = [p.strip() for p in line.split(',')]
        if len(parts) < 8:
            continue

        # parts[0] = JDTDB (float), parts[1] = calendar date string
        cal = parts[1].strip()
        # Remove any leading/trailing quotes
        cal = cal.strip("'\" ")

        try:
            utc_z, epoch_ms = _parse_horizons_epoch(cal)
        except ValueError:
            continue

        try:
            x  = float(parts[2])
            y  = float(parts[3])
            z  = float(parts[4])
            vx = float(parts[5])
            vy = float(parts[6])
            vz = float(parts[7])
        except (ValueError, IndexError):
            continue

        samples.append({
            'epochUtc':    utc_z,
            'epochMs':     epoch_ms,
            'positionKm':  [x, y, z],
            'velocityKmS': [vx, vy, vz],
        })

    return samples


# ── Output builder ────────────────────────────────────────────────

def build_moon_json(mission_id: str, samples: list[dict]) -> dict:
    """Wrap Moon samples into the artemis-orbits normalized schema."""
    start_utc = samples[0]['epochUtc']  if samples else None
    stop_utc  = samples[-1]['epochUtc'] if samples else None

    return {
        'schemaVersion': '1.0.0',
        'kind': 'moon-vectors',
        'mission': {'id': mission_id},
        'source': {
            'type':    'jpl-horizons',
            'target':  TARGET,
            'center':  CENTER,
            'frame':   REF_FRAME,
            'units':   OUT_UNITS,
            'apiDocs': 'https://ssd-api.jpl.nasa.gov/doc/horizons.html',
        },
        'frame': {
            'centerName':     'EARTH',
            'referenceFrame': REF_FRAME,
            'timeSystem':     'UTC',
            'positionUnits':  'km',
            'velocityUnits':  'km/s',
        },
        'segments': [
            {
                'id': 'segment-0',
                'metadata': {
                    'objectName': 'Moon',
                    'objectId':   TARGET,
                    'startTime':  start_utc,
                    'stopTime':   stop_utc,
                    'interpolation': 'LAGRANGE',
                    'interpolationDegree': 5,
                    'comments': ['Fetched from JPL Horizons'],
                },
                'samples': samples,
            }
        ],
        'derived': {
            'sampleCount':  len(samples),
            'segmentCount': 1,
            'missionStartUtc': start_utc,
            'missionStopUtc':  stop_utc,
        },
    }


# ── CLI ───────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='Fetch Moon vectors from JPL Horizons for a given mission window.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        '--input', required=True,
        help='Path to normalized mission JSON (produced by normalize_oem.py)',
    )
    parser.add_argument(
        '--output', required=True,
        help='Path to write Moon vectors JSON',
    )
    parser.add_argument(
        '--step', default='4h',
        help='Horizons step size (default: 4h). Examples: 1h, 30m, 1d.',
    )
    args = parser.parse_args()

    # Load mission JSON to get time window
    mission_path = Path(args.input)
    if not mission_path.exists():
        print(f'ERROR: Input file not found: {mission_path}', file=sys.stderr)
        sys.exit(1)

    mission_data = json.loads(mission_path.read_text(encoding='utf-8'))
    derived      = mission_data.get('derived', {})
    mission_id   = mission_data.get('mission', {}).get('id', 'unknown')

    start_utc = derived.get('missionStartUtc')
    stop_utc  = derived.get('missionStopUtc')

    if not start_utc or not stop_utc:
        print('ERROR: Input JSON missing derived.missionStartUtc or missionStopUtc.', file=sys.stderr)
        sys.exit(1)

    print(f'Mission: {mission_id}')
    print(f'Window:  {start_utc} → {stop_utc}')

    # Query Horizons
    try:
        raw_text = query_horizons(start_utc, stop_utc, step=args.step)
    except RuntimeError as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        sys.exit(1)

    # Parse
    try:
        samples = parse_horizons_response(raw_text)
    except ValueError as exc:
        print(f'ERROR parsing Horizons response: {exc}', file=sys.stderr)
        print('--- Raw response (first 2000 chars) ---')
        print(raw_text[:2000])
        sys.exit(1)

    print(f'Parsed {len(samples)} Moon vector sample(s).')

    if not samples:
        print('WARNING: No samples parsed – check the Horizons response.', file=sys.stderr)

    # Write output
    out_doc  = build_moon_json(mission_id, samples)
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out_doc, indent=2), encoding='utf-8')
    print(f'Written to: {out_path}')


if __name__ == '__main__':
    main()
