# Source Inspection Notes

This document records the official NASA source URLs, OEM format clues,
and parsing assumptions used by `scripts/normalize_oem.py` and
`scripts/fetch_moon_vectors.py`.

---

## Official NASA Pages and Data Files

### Artemis I

| Field | Value |
|-------|-------|
| Official page | https://www.nasa.gov/missions/artemis/orion/track-nasas-artemis-i-mission-in-real-time/ |
| OEM ZIP | https://www.nasa.gov/wp-content/uploads/2022/08/post-tli-orion-asflown-20221213-eph-oem.zip |
| Type | As-flown (post-mission) |
| Notes | Plain CCSDS OEM inside a ZIP; no HTML wrapper observed |

### Artemis II

| Field | Value |
|-------|-------|
| Official page | https://www.nasa.gov/missions/artemis/artemis-2/track-nasas-artemis-ii-mission-in-real-time/ |
| OEM ZIP | https://www.nasa.gov/wp-content/uploads/2026/03/artemis-ii-oem-2026-04-04-to-ei.zip |
| Type | As-flown |
| Notes | The `.asc` member inside the ZIP **may** be wrapped in HTML boilerplate before `CCSDS_OEM_VERS`. The sanitizer handles this automatically. |

---

## OEM Format Clues

The following header lines are expected in every valid OEM file:

```
CCSDS_OEM_VERS = 2.0
CENTER_NAME    = EARTH
REF_FRAME      = EME2000
TIME_SYSTEM    = UTC
```

Each segment is delimited by `META_START` / `META_STOP` and an optional
`DATA_START` / `DATA_STOP` pair.

---

## Parsing Assumptions

### Sample records

```
EPOCH X Y Z VX VY VZ [AX AY AZ]
```

- **EPOCH** — ISO-8601 UTC, e.g. `2026-04-02T03:07:49.583`
- **X Y Z** — position in **km** (EME2000, Earth-centred)
- **VX VY VZ** — velocity in **km/s**
- Optional **AX AY AZ** acceleration columns are ignored

### Covariance blocks

`COVARIANCE_START … COVARIANCE_STOP` blocks are skipped entirely.

### Segment boundaries

Segment boundaries (META_START/META_STOP) **must be preserved** in the
output JSON.  Interpolation is never performed across segment boundaries
because the trajectory may be discontinuous there.

### Epochs

All epochs are converted to UTC ISO-8601 strings with a trailing `Z`
(millisecond precision) and to Unix epoch milliseconds.

---

## JPL Horizons Choices

| Parameter | Value | Reason |
|-----------|-------|--------|
| Target | `301` | Moon |
| Center | `500@399` | Earth geocentre (same frame as OEM) |
| Reference frame | `J2000` | Matches EME2000 for this purpose |
| Ephem type | `VECTORS` | State vectors (position + velocity) |
| Units | `KM-S` | Kilometres, km/s – matches OEM |
| Light-time correction | `NONE` | We want geometric vectors for visualization |

API documentation: https://ssd-api.jpl.nasa.gov/doc/horizons.html
