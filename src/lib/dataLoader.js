/**
 * dataLoader.js – fetch and parse normalized mission/event JSON files.
 */

const _segmentBoundsCache = new WeakMap();

/**
 * Load a JSON file by URL.
 * Returns parsed JSON or null if missing/unreadable.
 *
 * @param {string|null|undefined} path
 * @returns {Promise<object|null>}
 */
export async function loadJson(path) {
  if (!path) return null;
  try {
    const res = await fetch(resolveAssetUrl(path));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export const loadMissionData = loadJson;

/**
 * Resolve a relative asset path against the current module.
 * Keeps asset URLs relative to the current document so prefixed deployments
 * work when the host rewrites the prefix back to the repo root.
 *
 * @param {string} path
 * @returns {string}
 */
export function resolveAssetUrl(path) {
  return new URL(path, document.baseURI).toString();
}

/**
 * Flatten all samples from all segments into one sorted array.
 * Each sample gets segment index metadata.
 *
 * @param {object} missionData
 * @returns {Array<object>}
 */
export function flattenSamples(missionData) {
  if (!missionData?.segments) return [];
  const flat = [];
  for (let segmentIdx = 0; segmentIdx < missionData.segments.length; segmentIdx++) {
    const seg = missionData.segments[segmentIdx];
    for (let sampleIdx = 0; sampleIdx < (seg.samples || []).length; sampleIdx++) {
      const sample = seg.samples[sampleIdx];
      flat.push({ ...sample, segmentIdx, sampleIdx });
    }
  }
  flat.sort((a, b) => a.epochMs - b.epochMs);
  return flat;
}

/**
 * Return sorted segment bounds [{segment, segmentIdx, startMs, stopMs, sampleCount}].
 *
 * @param {object|null} missionData
 * @returns {Array<object>}
 */
export function getSortedSegmentBounds(missionData) {
  if (!missionData || typeof missionData !== 'object') return [];
  const cached = _segmentBoundsCache.get(missionData);
  if (cached) return cached;
  const segs = missionData?.segments || [];
  const bounds = [];
  for (let segmentIdx = 0; segmentIdx < segs.length; segmentIdx++) {
    const samples = segs[segmentIdx]?.samples || [];
    if (!samples.length) continue;
    bounds.push({
      segment: segs[segmentIdx],
      segmentIdx,
      startMs: samples[0].epochMs,
      stopMs: samples[samples.length - 1].epochMs,
      sampleCount: samples.length,
    });
  }
  bounds.sort((a, b) => a.startMs - b.startMs || a.stopMs - b.stopMs);
  _segmentBoundsCache.set(missionData, bounds);
  return bounds;
}

/**
 * Mission time bounds convenience helper.
 *
 * @param {object|null} missionData
 * @returns {{startMs:number, stopMs:number}|null}
 */
export function getMissionTimeBounds(missionData) {
  const bounds = getSortedSegmentBounds(missionData);
  if (!bounds.length) return null;
  return { startMs: bounds[0].startMs, stopMs: bounds[bounds.length - 1].stopMs };
}

/**
 * Locate segment for a mission time.
 * Returns structured data including gap handling.
 *
 * @param {object|null} missionData
 * @param {number} tMs
 * @returns {{state:string, segment:object|null, segmentIdx:number|null, snappedMs:number|null, gap?:{prevStopMs:number,nextStartMs:number,nearestBoundaryMs:number}}}
 */
export function findSegment(missionData, tMs, precomputedBounds = null) {
  const bounds = Array.isArray(precomputedBounds) ? precomputedBounds : getSortedSegmentBounds(missionData);
  if (!bounds.length) {
    return { state: 'no-data', segment: null, segmentIdx: null, snappedMs: null };
  }

  const first = bounds[0];
  const last = bounds[bounds.length - 1];

  if (tMs < first.startMs) {
    return {
      state: 'before-start',
      segment: first.segment,
      segmentIdx: first.segmentIdx,
      snappedMs: first.startMs,
    };
  }

  if (tMs > last.stopMs) {
    return {
      state: 'after-end',
      segment: last.segment,
      segmentIdx: last.segmentIdx,
      snappedMs: last.stopMs,
    };
  }

  // Binary search: last segment whose start <= tMs.
  let lo = 0;
  let hi = bounds.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bounds[mid].startMs <= tMs) lo = mid + 1;
    else hi = mid;
  }

  const prevIdx = lo - 1;
  const prev = prevIdx >= 0 ? bounds[prevIdx] : null;
  if (prev && tMs <= prev.stopMs) {
    return {
      state: 'in-segment',
      segment: prev.segment,
      segmentIdx: prev.segmentIdx,
      snappedMs: tMs,
    };
  }

  const next = lo < bounds.length ? bounds[lo] : null;
  if (prev && next && tMs > prev.stopMs && tMs < next.startMs) {
    const nearestIsPrev = (tMs - prev.stopMs) <= (next.startMs - tMs);
    const nearestBoundaryMs = nearestIsPrev ? prev.stopMs : next.startMs;
    return {
      state: 'gap',
      segment: null,
      segmentIdx: null,
      snappedMs: nearestBoundaryMs,
      gap: {
        prevStopMs: prev.stopMs,
        nextStartMs: next.startMs,
        nearestBoundaryMs,
        nearestSegment: nearestIsPrev ? prev.segment : next.segment,
        nearestSegmentIdx: nearestIsPrev ? prev.segmentIdx : next.segmentIdx,
      },
    };
  }

  return {
    state: 'unknown',
    segment: null,
    segmentIdx: null,
    snappedMs: null,
  };
}

/**
 * Return nearest sample index for display.
 *
 * @param {Array<object>} flatSamples
 * @param {number} tMs
 * @returns {number}
 */
export function findSampleIndex(flatSamples, tMs) {
  if (!flatSamples?.length) return 0;
  let lo = 0;
  let hi = flatSamples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (flatSamples[mid].epochMs <= tMs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Sort and sanitize events.
 *
 * @param {Array<object>|null} events
 * @returns {Array<object>}
 */
export function sortEvents(events) {
  if (!Array.isArray(events)) return [];
  return events
    .map((event, idx) => {
      const epochMs = Date.parse(event.epochUtc);
      if (!Number.isFinite(epochMs)) return null;
      return {
        id: event.id || `event-${idx}`,
        label: event.label || event.id || `Event ${idx + 1}`,
        epochUtc: event.epochUtc,
        epochMs,
        metSeconds: Number.isFinite(event.metSeconds) ? event.metSeconds : null,
        type: event.type || 'milestone',
        description: event.description || '',
        verified: event.verified === true,
        sourceNote: event.sourceNote || '',
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.epochMs - b.epochMs);
}

/**
 * Nearest event lookup with prev/next pointers.
 *
 * @param {Array<object>} events
 * @param {number} currentMs
 * @returns {{nearest:object|null, previous:object|null, next:object|null, active:object|null}}
 */
export function getEventContext(events, currentMs) {
  if (!events.length) return { nearest: null, previous: null, next: null, active: null };

  let lo = 0;
  let hi = events.length - 1;
  let previousIdx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].epochMs <= currentMs) {
      previousIdx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const previous = previousIdx >= 0 ? events[previousIdx] : null;
  const next = previousIdx + 1 < events.length ? events[previousIdx + 1] : null;

  let nearest = null;
  if (previous && next) {
    nearest = Math.abs(previous.epochMs - currentMs) <= Math.abs(next.epochMs - currentMs)
      ? previous
      : next;
  } else {
    nearest = previous || next || null;
  }

  const activeWindowMs = 5 * 60_000;
  const active = nearest && Math.abs(nearest.epochMs - currentMs) <= activeWindowMs ? nearest : null;

  return { nearest, previous, next, active };
}
