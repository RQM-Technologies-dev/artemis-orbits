#!/usr/bin/env python3
"""
normalize_oem.py
================
Normalize a NASA/CCSDS OEM ZIP or ASCII file into a JSON schema that
the artemis-orbits viewer can consume.

Supports:
  • Remote download via --official-zip-url
  • Local ZIP or plain ASCII OEM via --input
  • HTML/junk wrapper stripping before CCSDS_OEM_VERS
  • Multiple segments, covariance block skipping
  • Sample records: EPOCH X Y Z VX VY VZ [AX AY AZ]
  • Epoch conversion to UTC ISO-8601 with trailing Z
  • Derived summary fields

Usage examples:
  # Download directly from NASA
  python3 scripts/normalize_oem.py \\
    --mission-id artemis-2 \\
    --display-name "Artemis II" \\
    --status as-flown \\
    --official-page-url "https://www.nasa.gov/..." \\
    --official-zip-url  "https://www.nasa.gov/.../artemis-ii-oem.zip" \\
    --output data/normalized/artemis-2.json

  # Use a local file
  python3 scripts/normalize_oem.py \\
    --mission-id artemis-1 \\
    --display-name "Artemis I" \\
    --status as-flown \\
    --official-page-url "https://www.nasa.gov/..." \\
    --input data/raw/post-tli-orion-asflown-20221213-eph-oem.zip \\
    --output data/normalized/artemis-1.json
"""

import argparse
import io
import json
import re
import statistics
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path


# ── Epoch parsing ─────────────────────────────────────────────────

def parse_epoch(epoch_str: str) -> datetime:
    """
    Parse a CCSDS epoch string into an aware UTC datetime.

    Accepted formats (with or without fractional seconds):
      2022-12-11T22:57:00.000
      2026-04-02T03:07:49.583
    """
    s = epoch_str.strip().rstrip('Z')
    for fmt in (
        '%Y-%m-%dT%H:%M:%S.%f',
        '%Y-%m-%dT%H:%M:%S',
        '%Y-%jT%H:%M:%S.%f',
        '%Y-%jT%H:%M:%S',
    ):
        try:
            dt = datetime.strptime(s, fmt)
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    raise ValueError(f"Cannot parse epoch: {epoch_str!r}")


def epoch_to_utc_iso(epoch_str: str) -> str:
    """Return UTC ISO-8601 string with trailing Z, no sub-second noise."""
    dt = parse_epoch(epoch_str)
    # Keep up to millisecond precision
    ms = dt.microsecond // 1000
    base = dt.strftime('%Y-%m-%dT%H:%M:%S')
    return f"{base}.{ms:03d}Z"


def epoch_to_ms(epoch_str: str) -> int:
    """Return Unix epoch milliseconds (int)."""
    dt = parse_epoch(epoch_str)
    return int(dt.timestamp() * 1000)


# ── Text sanitizer ────────────────────────────────────────────────

def sanitize_oem_text(raw: str) -> str:
    """
    Strip any leading HTML or junk text before the first CCSDS_OEM_VERS
    line, and any trailing noise after the OEM body.

    Returns the clean OEM ASCII text.
    """
    # Find the first occurrence of CCSDS_OEM_VERS (case-insensitive)
    match = re.search(r'(?im)^CCSDS_OEM_VERS\s*=', raw)
    if not match:
        raise ValueError(
            "Could not find 'CCSDS_OEM_VERS' in the input. "
            "Verify this is a CCSDS OEM file."
        )
    return raw[match.start():]


# ── OEM parser ────────────────────────────────────────────────────

def parse_oem(text: str) -> list[dict]:
    """
    Parse sanitized OEM text into a list of segment dicts:

    [
      {
        "metadata": { objectName, objectId, startTime, stopTime,
                      useableStartTime, useableStopTime,
                      interpolation, interpolationDegree, comments },
        "samples":  [ { epochUtc, epochMs, positionKm, velocityKmS } ]
      }
    ]

    Covariance blocks (COVARIANCE_START … COVARIANCE_STOP) are skipped.
    """
    segments = []
    current_meta = {}
    current_samples = []
    in_covariance = False
    in_data = False
    comments = []

    # Regex for a data record line: EPOCH X Y Z VX VY VZ [AX AY AZ]
    DATA_RE = re.compile(
        r'^\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+'
        r'([+-]?\d+\.?\d*(?:[eE][+-]?\d+)?)\s+'
        r'([+-]?\d+\.?\d*(?:[eE][+-]?\d+)?)\s+'
        r'([+-]?\d+\.?\d*(?:[eE][+-]?\d+)?)\s+'
        r'([+-]?\d+\.?\d*(?:[eE][+-]?\d+)?)\s+'
        r'([+-]?\d+\.?\d*(?:[eE][+-]?\d+)?)\s+'
        r'([+-]?\d+\.?\d*(?:[eE][+-]?\d+)?)'
    )

    def flush_segment():
        nonlocal current_meta, current_samples, comments
        if current_samples:
            meta_copy = dict(current_meta)
            meta_copy['comments'] = list(comments)
            segments.append({'metadata': meta_copy, 'samples': list(current_samples)})
        current_meta    = {}
        current_samples = []
        comments        = []

    for raw_line in text.splitlines():
        line = raw_line.strip()

        # Skip blank lines
        if not line:
            continue

        # Comment lines
        if line.startswith('COMMENT'):
            comments.append(line[7:].strip())
            continue

        # Covariance blocks
        if line.upper() == 'COVARIANCE_START':
            in_covariance = True
            continue
        if line.upper() == 'COVARIANCE_STOP':
            in_covariance = False
            continue
        if in_covariance:
            continue

        # Segment boundaries
        if line.upper() == 'META_START':
            flush_segment()
            in_data = False
            continue
        if line.upper() == 'META_STOP':
            in_data = True
            continue
        if line.upper() == 'DATA_START':
            in_data = True
            continue
        if line.upper() == 'DATA_STOP':
            in_data = False
            continue

        # Key = Value metadata lines (outside data block)
        if not in_data and '=' in line and not line.startswith('CCSDS'):
            key, _, val = line.partition('=')
            key = key.strip().upper()
            val = val.strip()
            meta_key_map = {
                'OBJECT_NAME':           'objectName',
                'OBJECT_ID':             'objectId',
                'START_TIME':            'startTime',
                'STOP_TIME':             'stopTime',
                'USEABLE_START_TIME':    'useableStartTime',
                'USEABLE_STOP_TIME':     'useableStopTime',
                'INTERPOLATION':         'interpolation',
                'INTERPOLATION_DEGREE':  'interpolationDegree',
            }
            if key in meta_key_map:
                mapped = meta_key_map[key]
                if key in ('START_TIME', 'STOP_TIME', 'USEABLE_START_TIME', 'USEABLE_STOP_TIME'):
                    current_meta[mapped] = epoch_to_utc_iso(val)
                elif key == 'INTERPOLATION_DEGREE':
                    try:
                        current_meta[mapped] = int(val)
                    except ValueError:
                        current_meta[mapped] = val
                else:
                    current_meta[mapped] = val
            continue

        # Data records
        if in_data:
            m = DATA_RE.match(line)
            if m:
                epoch_str = m.group(1)
                x, y, z       = float(m.group(2)), float(m.group(3)), float(m.group(4))
                vx, vy, vz    = float(m.group(5)), float(m.group(6)), float(m.group(7))
                current_samples.append({
                    'epochUtc':    epoch_to_utc_iso(epoch_str),
                    'epochMs':     epoch_to_ms(epoch_str),
                    'positionKm':  [x, y, z],
                    'velocityKmS': [vx, vy, vz],
                })

    flush_segment()
    return segments


# ── Derived summary ───────────────────────────────────────────────

def compute_derived(segments: list[dict]) -> dict:
    """Compute sampleCount, segmentCount, time bounds, step, boundsKm."""
    all_samples = [s for seg in segments for s in seg['samples']]
    count = len(all_samples)

    if count == 0:
        return {
            'sampleCount': 0,
            'segmentCount': len(segments),
            'missionStartUtc': None,
            'missionStopUtc':  None,
            'nominalStepSecondsMedian': None,
            'boundsKm': {'min': [0, 0, 0], 'max': [0, 0, 0]},
        }

    start_utc = all_samples[0]['epochUtc']
    stop_utc  = all_samples[-1]['epochUtc']

    # Step intervals (within each segment only)
    steps = []
    for seg in segments:
        samps = seg['samples']
        for i in range(1, len(samps)):
            dt_s = (samps[i]['epochMs'] - samps[i - 1]['epochMs']) / 1000.0
            if dt_s > 0:
                steps.append(dt_s)
    median_step = round(statistics.median(steps), 3) if steps else None

    # Position bounds
    xs = [s['positionKm'][0] for s in all_samples]
    ys = [s['positionKm'][1] for s in all_samples]
    zs = [s['positionKm'][2] for s in all_samples]

    return {
        'sampleCount':             count,
        'segmentCount':            len(segments),
        'missionStartUtc':         start_utc,
        'missionStopUtc':          stop_utc,
        'nominalStepSecondsMedian': median_step,
        'boundsKm': {
            'min': [min(xs), min(ys), min(zs)],
            'max': [max(xs), max(ys), max(zs)],
        },
    }


# ── Source extraction ─────────────────────────────────────────────

def extract_oem_text(path_or_bytes, source_info: dict) -> tuple[str, str]:
    """
    Given a path (str/Path) or raw bytes, return (oem_text, member_name).

    If the input is a ZIP, find the first .asc / .txt / .oem member.
    If it is plain text, return it directly.
    """
    # Load bytes if given a path
    if isinstance(path_or_bytes, (str, Path)):
        data = Path(path_or_bytes).read_bytes()
    else:
        data = path_or_bytes

    # Try ZIP
    if data[:2] == b'PK':
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            members = zf.namelist()
            # Prefer .asc → .oem → .txt order
            candidate = None
            for ext in ('.asc', '.oem', '.txt'):
                for name in members:
                    if name.lower().endswith(ext):
                        candidate = name
                        break
                if candidate:
                    break
            if candidate is None:
                # Fall back to first non-directory member
                candidate = next((n for n in members if not n.endswith('/')), members[0])
            member_name = candidate
            raw_bytes = zf.read(candidate)
    else:
        member_name = source_info.get('inputPath', 'inline')
        raw_bytes = data

    # Decode
    for enc in ('utf-8', 'latin-1'):
        try:
            return raw_bytes.decode(enc), member_name
        except UnicodeDecodeError:
            continue
    raise ValueError("Cannot decode OEM file as UTF-8 or Latin-1.")


# ── CLI ───────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description='Normalize a NASA/CCSDS OEM file to artemis-orbits JSON.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument('--mission-id',       required=True, help='e.g. artemis-2')
    p.add_argument('--display-name',     required=True, help='e.g. "Artemis II"')
    p.add_argument('--status',           required=True, help='e.g. as-flown | planned')
    p.add_argument('--official-page-url', required=True)
    p.add_argument('--official-zip-url',  default=None)
    p.add_argument('--input',            default=None,  help='Local ZIP or ASCII OEM path')
    p.add_argument('--output',           required=True, help='Path to write JSON output')
    return p


def main():
    args = build_parser().parse_args()

    if not args.official_zip_url and not args.input:
        print('ERROR: Provide either --official-zip-url or --input.', file=sys.stderr)
        sys.exit(1)

    # ── Acquire raw bytes ──────────────────────────────────────────
    source_info: dict = {
        'type':            'nasa-oem-zip',
        'officialPageUrl': args.official_page_url,
        'officialZipUrl':  args.official_zip_url,
    }

    if args.input:
        print(f'Reading local file: {args.input}')
        source_info['inputPath'] = str(args.input)
        raw_data = Path(args.input).read_bytes()
    else:
        print(f'Downloading: {args.official_zip_url}')
        try:
            with urllib.request.urlopen(args.official_zip_url, timeout=120) as resp:
                raw_data = resp.read()
        except Exception as exc:
            print(f'ERROR downloading OEM: {exc}', file=sys.stderr)
            sys.exit(1)

    # ── Extract + sanitize ─────────────────────────────────────────
    try:
        raw_text, member_name = extract_oem_text(raw_data, source_info)
    except Exception as exc:
        print(f'ERROR extracting OEM: {exc}', file=sys.stderr)
        sys.exit(1)

    source_info['extractedMemberName'] = member_name

    try:
        clean_text = sanitize_oem_text(raw_text)
    except ValueError as exc:
        print(f'ERROR sanitizing OEM: {exc}', file=sys.stderr)
        sys.exit(1)

    # ── Parse ──────────────────────────────────────────────────────
    try:
        segments = parse_oem(clean_text)
    except Exception as exc:
        print(f'ERROR parsing OEM: {exc}', file=sys.stderr)
        sys.exit(1)

    if not segments:
        print('WARNING: No segments parsed – check the OEM file.', file=sys.stderr)

    total = sum(len(s['samples']) for s in segments)
    print(f'Parsed {len(segments)} segment(s), {total} sample(s).')

    # ── Assemble output ────────────────────────────────────────────
    derived = compute_derived(segments)

    # Attach segment IDs and frame info
    for i, seg in enumerate(segments):
        seg['id'] = f'segment-{i}'

    output_doc = {
        'schemaVersion': '1.0.0',
        'kind': 'artemis-mission-trajectory',
        'mission': {
            'id':          args.mission_id,
            'displayName': args.display_name,
            'status':      args.status,
        },
        'source': source_info,
        'frame': {
            'centerName':     'EARTH',
            'referenceFrame': 'EME2000',
            'timeSystem':     'UTC',
            'positionUnits':  'km',
            'velocityUnits':  'km/s',
        },
        'segments': segments,
        'derived': derived,
    }

    # ── Write output ───────────────────────────────────────────────
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(output_doc, indent=2), encoding='utf-8')
    print(f'Written to: {out_path}')


if __name__ == '__main__':
    main()
