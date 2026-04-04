/**
 * interpolate.js – sample interpolation within a segment.
 *
 * Rules
 * ─────
 * • Interpolation NEVER crosses segment boundaries.
 * • When segment metadata requests LAGRANGE and enough neighbouring
 *   points are available, use local Lagrange interpolation.
 * • Fall back to linear interpolation near edges or when the
 *   degree cannot be satisfied.
 */

/**
 * Interpolate a position/velocity vector at time `tMs` inside a segment.
 *
 * @param {object}   segment    – normalized segment object from JSON
 * @param {number}   tMs        – target epoch milliseconds (clamped to segment range)
 * @returns {{ positionKm: number[], velocityKmS: number[] }}
 */
export function interpolateSegment(segment, tMs) {
  const samples = segment.samples;
  if (!samples || samples.length === 0) {
    return { positionKm: [0, 0, 0], velocityKmS: [0, 0, 0] };
  }

  if (samples.length === 1) {
    return {
      positionKm:  [...samples[0].positionKm],
      velocityKmS: [...samples[0].velocityKmS],
    };
  }

  // Locate bracket: find i such that samples[i].epochMs <= tMs < samples[i+1].epochMs
  const n = samples.length;
  let lo = 0, hi = n - 1;

  // Clamp to segment bounds
  if (tMs <= samples[0].epochMs) {
    return { positionKm: [...samples[0].positionKm], velocityKmS: [...samples[0].velocityKmS] };
  }
  if (tMs >= samples[n - 1].epochMs) {
    return { positionKm: [...samples[n - 1].positionKm], velocityKmS: [...samples[n - 1].velocityKmS] };
  }

  // Binary search for bracket
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].epochMs <= tMs) lo = mid;
    else hi = mid;
  }

  // Determine interpolation method and degree
  const meta   = segment.metadata || {};
  const method = (meta.interpolation || 'LINEAR').toUpperCase();
  const degree = Number.isInteger(meta.interpolationDegree) ? meta.interpolationDegree : 1;

  if (method === 'LAGRANGE' && degree >= 2) {
    return lagrangeInterp(samples, lo, tMs, degree);
  }
  return linearInterp(samples[lo], samples[lo + 1], tMs);
}

// ── Linear interpolation ──────────────────────────────────────────

function linearInterp(s0, s1, tMs) {
  const dt = s1.epochMs - s0.epochMs;
  const f  = dt === 0 ? 0 : (tMs - s0.epochMs) / dt;
  return {
    positionKm:  lerpVec(s0.positionKm,  s1.positionKm,  f),
    velocityKmS: lerpVec(s0.velocityKmS, s1.velocityKmS, f),
  };
}

function lerpVec(a, b, f) {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

// ── Lagrange interpolation ────────────────────────────────────────

/**
 * Build a window of `degree+1` points centred around the bracket [lo, lo+1].
 * Falls back to linear when the window cannot be filled.
 */
function lagrangeInterp(samples, lo, tMs, degree) {
  const n      = samples.length;
  const needed = degree + 1;            // number of support points
  const half   = Math.floor(needed / 2);

  // Try to centre the window
  let start = lo - half + 1;
  start = Math.max(0, Math.min(start, n - needed));

  // Not enough points – fall back to linear
  if (n < needed || start < 0) {
    return linearInterp(samples[lo], samples[lo + 1], tMs);
  }

  const pts = samples.slice(start, start + needed);
  const t   = tMs;

  return {
    positionKm:  lagrangePoly(pts, t, 'positionKm'),
    velocityKmS: lagrangePoly(pts, t, 'velocityKmS'),
  };
}

/**
 * Classic Lagrange polynomial evaluated component-wise.
 * @param {object[]} pts    – array of sample objects
 * @param {number}   t      – target epoch ms
 * @param {string}   field  – 'positionKm' | 'velocityKmS'
 * @returns {number[]}
 */
function lagrangePoly(pts, t, field) {
  const n   = pts.length;
  const out = [0, 0, 0];

  for (let i = 0; i < n; i++) {
    let Li = 1;
    for (let j = 0; j < n; j++) {
      if (j !== i) {
        Li *= (t - pts[j].epochMs) / (pts[i].epochMs - pts[j].epochMs);
      }
    }
    const v = pts[i][field];
    out[0] += Li * v[0];
    out[1] += Li * v[1];
    out[2] += Li * v[2];
  }
  return out;
}
