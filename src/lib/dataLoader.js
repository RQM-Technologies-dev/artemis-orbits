/**
 * dataLoader.js – fetch and parse normalized mission JSON files.
 *
 * Handles missing files gracefully: returns null instead of throwing,
 * so the UI can display a helpful message.
 */

/**
 * Load a normalized trajectory JSON file.
 * Returns the parsed object or null if the file cannot be fetched.
 *
 * @param {string} path – relative URL (e.g. './data/normalized/artemis-2.json')
 * @returns {Promise<object|null>}
 */
export async function loadMissionData(path) {
  if (!path) return null;
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Flatten all samples from all segments into one sorted array,
 * tagging each sample with its segment index.
 *
 * Segment boundaries are preserved: samples from different segments
 * are never merged – they just appear in chronological order with
 * a `segmentIdx` field for boundary checks.
 *
 * @param {object} missionData – parsed normalized JSON
 * @returns {Array<object>}    – flat sample array
 */
export function flattenSamples(missionData) {
  if (!missionData?.segments) return [];
  const flat = [];
  for (let si = 0; si < missionData.segments.length; si++) {
    const seg = missionData.segments[si];
    for (const s of (seg.samples || [])) {
      flat.push({ ...s, segmentIdx: si });
    }
  }
  // Sort by epochMs in case segments overlap or are out of order
  flat.sort((a, b) => a.epochMs - b.epochMs);
  return flat;
}

/**
 * Find the segment that owns time `tMs`.
 * Returns the segment object or the first/last if out of range.
 *
 * @param {object} missionData
 * @param {number} tMs
 * @returns {object|null}
 */
export function findSegment(missionData, tMs) {
  const segs = missionData?.segments;
  if (!segs || segs.length === 0) return null;

  for (const seg of segs) {
    const samples = seg.samples || [];
    if (samples.length === 0) continue;
    const start = samples[0].epochMs;
    const stop  = samples[samples.length - 1].epochMs;
    if (tMs >= start && tMs <= stop) return seg;
  }

  // Out of range – return nearest boundary segment
  const first = segs[0];
  const last  = segs[segs.length - 1];
  const firstStart = first.samples?.[0]?.epochMs ?? -Infinity;
  const lastStop   = last.samples?.[last.samples.length - 1]?.epochMs ?? Infinity;
  return tMs < firstStart ? first : last;
}

/**
 * Return the index of the sample in `flatSamples` that best
 * corresponds to time `tMs` (the last sample with epochMs ≤ tMs).
 *
 * @param {Array<object>} flatSamples
 * @param {number}        tMs
 * @returns {number} – index (0 … length-1)
 */
export function findSampleIndex(flatSamples, tMs) {
  if (!flatSamples || flatSamples.length === 0) return 0;
  let lo = 0, hi = flatSamples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (flatSamples[mid].epochMs <= tMs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
