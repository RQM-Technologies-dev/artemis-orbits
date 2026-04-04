# artemis-orbits

**NASA Artemis Orbit Viewer** — a static 3D browser visualization of Earth, Moon, and Orion plus Python tooling that normalizes official NASA OEM ephemeris files into a clean JSON format ready for playback.

> No fabricated trajectory data. Load real NASA OEM ZIP files, run the normalizer, and see Orion fly.

---

## Official Data Sources

| Mission | Official Page | OEM ZIP |
|---------|--------------|---------|
| Artemis I | [Track Artemis I](https://www.nasa.gov/missions/artemis/orion/track-nasas-artemis-i-mission-in-real-time/) | [post-tli-orion-asflown-20221213-eph-oem.zip](https://www.nasa.gov/wp-content/uploads/2022/08/post-tli-orion-asflown-20221213-eph-oem.zip) |
| Artemis II | [Track Artemis II](https://www.nasa.gov/missions/artemis/artemis-2/track-nasas-artemis-ii-mission-in-real-time/) | [artemis-ii-oem-2026-04-04-to-ei.zip](https://www.nasa.gov/wp-content/uploads/2026/03/artemis-ii-oem-2026-04-04-to-ei.zip) |

Moon vectors come from the [JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html) (target 301, center 500@399, J2000, KM-S units).

---

## Repo Layout

```
artemis-orbits/
├── index.html                  # Single-page 3D viewer
├── styles.css                  # Dark-space theme
├── package.json                # Minimal – just a serve script
├── data/
│   ├── raw/                    # Drop NASA OEM ZIPs here
│   └── normalized/             # Output JSON from normalize_oem.py
├── docs/
│   └── source-inspection.md   # OEM format notes and parsing assumptions
├── scripts/
│   ├── normalize_oem.py        # OEM ZIP → normalized JSON
│   └── fetch_moon_vectors.py   # JPL Horizons → Moon JSON
├── src/
│   ├── app.js                  # Main app entry
│   ├── config/missions.js      # Mission configuration array
│   └── lib/
│       ├── dataLoader.js       # Fetch + parse normalized JSON
│       ├── interpolate.js      # Lagrange / linear interpolation
│       ├── scene.js            # Three.js scene setup
│       ├── time.js             # UTC / MET formatting
│       └── units.js            # km → scene unit conversion
└── tests/
    ├── sample_artemis_ii_like_html_wrapper.txt  # Test fixture
    └── test_normalize.py       # Python unit tests
```

---

## Normalized JSON Schema

```json
{
  "schemaVersion": "1.0.0",
  "kind": "artemis-mission-trajectory",
  "mission": { "id": "artemis-2", "displayName": "Artemis II", "status": "as-flown" },
  "source": {
    "type": "nasa-oem-zip",
    "officialPageUrl": "https://...",
    "officialZipUrl": "https://...",
    "extractedMemberName": "Artemis_II_OEM_2026_04_04_to_EI.asc"
  },
  "frame": {
    "centerName": "EARTH", "referenceFrame": "EME2000",
    "timeSystem": "UTC", "positionUnits": "km", "velocityUnits": "km/s"
  },
  "segments": [
    {
      "id": "segment-0",
      "metadata": {
        "objectName": "EM2", "objectId": "24",
        "startTime": "2026-04-02T03:07:49.583Z",
        "stopTime":  "2026-04-10T23:53:12.332Z",
        "interpolation": "LAGRANGE", "interpolationDegree": 8,
        "comments": []
      },
      "samples": [
        {
          "epochUtc": "2026-04-02T03:07:49.583Z",
          "epochMs": 1775099269583,
          "positionKm": [0, 0, 0],
          "velocityKmS": [0, 0, 0]
        }
      ]
    }
  ],
  "derived": {
    "sampleCount": 1, "segmentCount": 1,
    "missionStartUtc": "2026-04-02T03:07:49.583Z",
    "missionStopUtc":  "2026-04-10T23:53:12.332Z",
    "nominalStepSecondsMedian": 240.0,
    "boundsKm": { "min": [0,0,0], "max": [0,0,0] }
  }
}
```

---

## Quick Start

### 1 – Normalize Artemis I (download from NASA)

```bash
python3 scripts/normalize_oem.py \
  --mission-id artemis-1 \
  --display-name "Artemis I" \
  --status as-flown \
  --official-page-url "https://www.nasa.gov/missions/artemis/orion/track-nasas-artemis-i-mission-in-real-time/" \
  --official-zip-url  "https://www.nasa.gov/wp-content/uploads/2022/08/post-tli-orion-asflown-20221213-eph-oem.zip" \
  --output data/normalized/artemis-1.json
```

Or with a local ZIP already in `data/raw/`:

```bash
python3 scripts/normalize_oem.py \
  --mission-id artemis-1 \
  --display-name "Artemis I" \
  --status as-flown \
  --official-page-url "https://www.nasa.gov/missions/artemis/orion/track-nasas-artemis-i-mission-in-real-time/" \
  --input data/raw/post-tli-orion-asflown-20221213-eph-oem.zip \
  --output data/normalized/artemis-1.json
```

### 2 – Normalize Artemis II

```bash
python3 scripts/normalize_oem.py \
  --mission-id artemis-2 \
  --display-name "Artemis II" \
  --status as-flown \
  --official-page-url "https://www.nasa.gov/missions/artemis/artemis-2/track-nasas-artemis-ii-mission-in-real-time/" \
  --official-zip-url  "https://www.nasa.gov/wp-content/uploads/2026/03/artemis-ii-oem-2026-04-04-to-ei.zip" \
  --output data/normalized/artemis-2.json
```

### 3 – Fetch Moon vectors

```bash
python3 scripts/fetch_moon_vectors.py \
  --input  data/normalized/artemis-2.json \
  --output data/normalized/artemis-2-moon.json
```

### 4 – Serve the viewer

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

Or with npm:

```bash
npm run serve
```

---

## Viewer Behaviour

- Opens on **Artemis II** by default.
- Tabs for Artemis I–V; Artemis III–V are disabled placeholders.
- If normalized JSON is missing a helpful message is shown:  
  *"Normalized data not found yet. Run scripts/normalize_oem.py and scripts/fetch_moon_vectors.py."*
- Playback controls: Play/Pause, Reset, ±1 hour, ±1 day, speed selector, timeline slider.
- UTC and Mission Elapsed Time are shown live.

---

## Notes / Caveats

- NASA publishes trajectories as **CCSDS OEM ZIPs**. The normalizer handles ZIP or plain ASCII input.
- **Segment boundaries must be preserved** – interpolation never crosses them.
- The Artemis II OEM may be wrapped in HTML/junk text before `CCSDS_OEM_VERS`. The sanitizer strips that automatically.
- Moon vectors are **Earth-centered** (same frame as Orion) so both bodies can be rendered together in the browser.

---

## What to Build Next

- **Mission facts panel** keyed to UTC/MET (launch events, TLI, LOI, splashdown).
- **Event callouts** that pop up at key trajectory milestones.
- **Camera presets** (Earth view, Moon approach, Orion close-up).
- **Artemis III–V nominal trajectories** once NASA publishes planning data.
