# artemis-orbits

Static NASA Artemis trajectory viewer (Earth/Moon/Orion) driven by normalized OEM ephemeris JSON.

> No fabricated trajectory data. Keep official NASA OEM sources and Python normalization pipeline as the source of truth.

## Official data sources

| Mission | Official page | OEM ZIP |
|---|---|---|
| Artemis I | https://www.nasa.gov/missions/artemis/orion/track-nasas-artemis-i-mission-in-real-time/ | https://www.nasa.gov/wp-content/uploads/2022/08/post-tli-orion-asflown-20221213-eph-oem.zip |
| Artemis II | https://www.nasa.gov/missions/artemis/artemis-2/track-nasas-artemis-ii-mission-in-real-time/ | https://www.nasa.gov/wp-content/uploads/2026/03/artemis-ii-oem-2026-04-04-to-ei.zip |

Moon vectors: JPL Horizons API (target 301, center 500@399, J2000, KM-S).

## Quick start

```bash
python3 scripts/normalize_oem.py --mission-id artemis-1 --display-name "Artemis I" --status as-flown --official-page-url "https://www.nasa.gov/missions/artemis/orion/track-nasas-artemis-i-mission-in-real-time/" --official-zip-url "https://www.nasa.gov/wp-content/uploads/2022/08/post-tli-orion-asflown-20221213-eph-oem.zip" --output data/normalized/artemis-1.json
python3 scripts/normalize_oem.py --mission-id artemis-2 --display-name "Artemis II" --status as-flown --official-page-url "https://www.nasa.gov/missions/artemis/artemis-2/track-nasas-artemis-ii-mission-in-real-time/" --official-zip-url "https://www.nasa.gov/wp-content/uploads/2026/03/artemis-ii-oem-2026-04-04-to-ei.zip" --output data/normalized/artemis-2.json
python3 scripts/fetch_moon_vectors.py --input data/normalized/artemis-1.json --output data/normalized/artemis-1-moon.json
python3 scripts/fetch_moon_vectors.py --input data/normalized/artemis-2.json --output data/normalized/artemis-2-moon.json
python3 -m http.server 8000
```

## Viewer behavior

- Segment-safe rendering: one polyline per OEM segment.
- Faint **full route** (entire mission) plus bright **traversed route** (up to current mission time), never connected across segment gaps.
- Playback is tied to `currentMs` mission UTC; wall-clock speed maps as:
  - `1x real time` = 1 mission second / wall second
  - `1 min/sec` = 60 mission seconds / wall second
  - `10 min/sec` = 600 mission seconds / wall second
  - `1 hr/sec` = 3600 mission seconds / wall second
  - `6 hr/sec` = 21600 mission seconds / wall second
  - `12 hr/sec` = 43200 mission seconds / wall second
  - `1 day/sec` = 86400 mission seconds / wall second
- Controls: play/pause, reset, jump start/end, previous/next event, ±1h, ±1d, timeline scrub.
- Timeline event ticks + sidebar nearest/active event label.
- Optional 3D event waypoint markers (interpolated from Orion state at event epoch).
- Camera presets: Earth-centered, Moon-approach, mission-fit.

## Event JSON schema

Event files are optional. Place them in `data/events/` and reference via `eventsPath` in mission config.

```json
[
  {
    "id": "launch",
    "label": "Launch",
    "epochUtc": "2026-04-01T15:47:00Z",
    "metSeconds": 0,
    "type": "milestone",
    "description": "Mission launch"
  }
]
```

Included starter files:
- `data/events/artemis-1.json`
- `data/events/artemis-2.json`

These are placeholders with TODO labeling and **must be replaced with verified official NASA mission event times before treating them as authoritative**.

## Vercel deployment

This app is static and deployment-safe for both root and subpath hosting.

1. Ensure generated normalized JSON exists in `data/normalized/`.
2. Deploy repo to Vercel as a static project (no build command required).
3. `vercel.json` includes clean URL handling and rewrites so both `/NASA/Artemis` and `/NASA/Artemis/` resolve cleanly.
4. Frontend URLs are relative/module-resolved so deployment works from `/` and nested paths.
5. `.vercelignore` excludes local-only artifacts (`data/raw/`, caches, large ZIP/OEM scratch files).

## Data notes

- Artemis I and Artemis II are enabled and expected to use normalized official NASA OEM trajectories.
- Artemis III–V remain disabled placeholders.
- Interpolation stays segment-local only (never across OEM segment boundaries).
- Gap times are handled explicitly so playback does not draw fake motion across missing spans.

## Tests

Python normalization tests:

```bash
python3 -m pytest tests/test_normalize.py
```
