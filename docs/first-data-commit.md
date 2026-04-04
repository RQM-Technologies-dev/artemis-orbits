# First data commit (Artemis viewer)

This repository is a **static** Artemis orbit viewer. The public site reads committed JSON files from `data/normalized/` and does not call NASA/JPL APIs from the browser at runtime.

## What this commit introduces

The first official-data workflow covers:

1. Normalize official NASA OEM inputs for Artemis I and Artemis II.
2. Generate Moon companion vectors from JPL Horizons for the same mission windows.
3. Generate a normalized manifest (`data/normalized/manifest.json`).
4. Validate required files and basic consistency.
5. Produce playback timing verification reports in `reports/`.

## Local commands (full workflow)

Run this sequence locally when network access to NASA/JPL is available:

```bash
npm run data:all
npm run validate:data
npm run verify:playback
npm run summarize:data
npm run data:check
```

You can also run mission-by-mission:

```bash
npm run data:artemis1
npm run data:artemis2
npm run data:manifest
```

Serve locally:

```bash
npm run serve
```

## Files that should be committed

Required truth-source artifacts:

- `data/normalized/artemis-1.json`
- `data/normalized/artemis-1-moon.json`
- `data/normalized/artemis-2.json`
- `data/normalized/artemis-2-moon.json`
- `data/normalized/manifest.json`

Playback reports (operator-facing, generated):

- `reports/artemis-1-playback-check.json`
- `reports/artemis-2-playback-check.json`

## Optional vs required

- **Required for public accuracy:** normalized mission JSON files, moon companion files, and manifest.
- **Optional but recommended:** playback verification report JSON files for auditability.
- **Optional for now:** event timestamps marked `verified: false` remain placeholders until confirmed from official NASA mission timeline materials.

## Playback verification report interpretation

`python3 scripts/verify_playback_timing.py` outputs both console summary and JSON report per mission.

It reports:

- mission time window (start/stop UTC)
- sample and segment counts
- nominal median mission step
- event range checks (`inside-range` vs `out-of-range`)
- nearest sample offset and interpolation support window details
- warnings and generation timestamp

Use this to verify timeline controls and event markers align with the normalized mission window.

## Data semantics

- **Official trajectory truth:** `data/normalized/artemis-*.json` derived from official NASA OEM files.
- **Generated Moon companion:** `data/normalized/artemis-*-moon.json` derived from JPL Horizons over the normalized mission window.
- **Placeholder event metadata:** `data/events/artemis-*.json` supports navigation/ticks, but is authoritative only when event entries are explicitly marked `verified: true`.

## Deployment target

Deploy as a separate static Vercel project, e.g. `artemis.rqmstudio.tech`, preserving current subpath-safe rewrite behavior in `vercel.json`.
