/**
 * time.js – UTC / MET formatting and clamping helpers.
 */

/**
 * Format a Date (or epoch ms) as a UTC ISO-8601 string with seconds.
 * Example: "2026-04-02T03:07:49Z"
 * @param {Date|number} t
 * @returns {string}
 */
export function formatUtc(t) {
  const d = t instanceof Date ? t : new Date(t);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Format mission elapsed time from startMs to nowMs.
 * Returns a string like "+02d 04h 31m 05s" or "-00d 00h 00m 01s".
 * @param {number} startMs  – epoch ms of mission start
 * @param {number} nowMs    – epoch ms of current playback time
 * @returns {string}
 */
export function formatMet(startMs, nowMs) {
  const sign = nowMs >= startMs ? '+' : '-';
  let diff = Math.abs(nowMs - startMs);

  const s = Math.floor(diff / 1000) % 60;
  const m = Math.floor(diff / 60_000) % 60;
  const h = Math.floor(diff / 3_600_000) % 24;
  const d = Math.floor(diff / 86_400_000);

  return (
    `${sign}${String(d).padStart(2, '0')}d ` +
    `${String(h).padStart(2, '0')}h ` +
    `${String(m).padStart(2, '0')}m ` +
    `${String(s).padStart(2, '0')}s`
  );
}

/**
 * Clamp a value between min and max (inclusive).
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
