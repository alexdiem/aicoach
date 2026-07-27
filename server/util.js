// Small shared helpers. No dependencies anywhere in this project by design.

/** ISO date (YYYY-MM-DD) for a Date or date-like string, in local terms. */
export function isoDate(d) {
  if (d == null) return null;
  if (typeof d === 'string') {
    // Accept "2026-07-27", "2026-07-27T06:12:00", "2026-07-27T06:12:00Z"
    const m = d.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    d = new Date(d);
  }
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/** Parse YYYY-MM-DD as a UTC-noon Date so DST never shifts the day. */
export function parseDate(s) {
  if (s instanceof Date) return s;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return new Date(NaN);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
}

export function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

/** Monday of the week containing dateStr. Weeks are Monday-based throughout. */
export function weekStart(dateStr) {
  const d = parseDate(dateStr);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  return addDays(dateStr, -dow);
}

export function today() {
  return isoDate(new Date());
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function round(v, dp = 1) {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

export function mean(arr) {
  const xs = arr.filter((x) => Number.isFinite(x));
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function median(arr) {
  const xs = arr.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

export function sum(arr) {
  return arr.filter((x) => Number.isFinite(x)).reduce((a, b) => a + b, 0);
}

export function pctChange(now, before) {
  if (!Number.isFinite(now) || !Number.isFinite(before) || before === 0) return null;
  return ((now - before) / before) * 100;
}

export function num(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

export function int(v) {
  const n = num(v);
  return n == null ? null : Math.round(n);
}

/** Format a signed number with an explicit sign, e.g. -22 or +7. */
export function signed(v, dp = 0) {
  const r = round(v, dp);
  if (r == null) return '?';
  return r > 0 ? `+${r}` : `${r}`;
}

export function hhmm(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function jsonOrNull(v) {
  if (v == null) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}
