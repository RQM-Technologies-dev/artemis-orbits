/**
 * geodesy.js - lightweight geodetic helpers for Earth surface targets.
 */

export const EARTH_RADIUS_KM = 6_371;

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeSurfaceTarget(surfaceTarget) {
  if (!surfaceTarget || typeof surfaceTarget !== 'object') return null;
  const latDeg = toFiniteNumber(surfaceTarget.latDeg, NaN);
  const lonDeg = toFiniteNumber(surfaceTarget.lonDeg, NaN);
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return null;
  return {
    latDeg,
    lonDeg,
    altitudeKm: toFiniteNumber(surfaceTarget.altitudeKm, 0),
    approximate: surfaceTarget.approximate === true,
    label: surfaceTarget.label ? String(surfaceTarget.label) : '',
  };
}

/**
 * Convert geodetic coordinates to Earth-centered cartesian coordinates (km).
 * The viewer currently uses a spherical Earth approximation.
 */
export function geodeticToCartesianKm(surfaceTarget, earthRadiusKm = EARTH_RADIUS_KM) {
  const normalized = normalizeSurfaceTarget(surfaceTarget);
  if (!normalized) return null;
  const latRad = (normalized.latDeg * Math.PI) / 180;
  const lonRad = (normalized.lonDeg * Math.PI) / 180;
  const radius = earthRadiusKm + normalized.altitudeKm;
  const cosLat = Math.cos(latRad);
  return [
    radius * cosLat * Math.cos(lonRad),
    radius * Math.sin(latRad),
    radius * cosLat * Math.sin(lonRad),
  ];
}
