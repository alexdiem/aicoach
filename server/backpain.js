// Back-pain monitoring.
//
// The hypothesis being tracked: pain correlates with high-intensity efforts in
// the drops, not with distance. So every view here stratifies by position AND
// intensity, and always shows the distance control alongside — otherwise a
// "drops rides hurt" pattern is indistinguishable from "long rides hurt".
//
// Deliberately not a statistical model. It surfaces counts and rates with the
// raw rides behind them, and says plainly when there isn't enough data.

import { db, getSettingNum } from './db.js';
import { addDays, mean, round, today } from './util.js';

const PAIN_ORDER = { none: 0, mild: 1, moderate: 2, flare: 3 };

export async function loggedRides(from, to) {
  return db
    .prepare(
      `SELECT a.id, a.date, a.name, a.type, a.intensity, a.vi, a.np, a.avg_power, a.tss,
              a.moving_time, a.distance_m, a.elevation_m,
              r.position, r.drops_minutes, r.back_pain, r.pain_onset, r.rpe, r.notes
       FROM ride_logs r
       JOIN activities a ON a.id = r.activity_id
       WHERE r.date >= ? AND r.date <= ? AND r.back_pain IS NOT NULL
       ORDER BY a.date DESC`
    )
    .all(from, to);
}

function isPain(row, threshold) {
  return (PAIN_ORDER[row.back_pain] ?? 0) >= threshold;
}

function rate(hits, n) {
  return n ? round((hits / n) * 100, 0) : null;
}

/**
 * The headline cross-tab: pain rate by position, within high-IF rides and
 * within lower-IF rides.
 *
 * @param severity 'moderate' (default: moderate+flare count as pain) | 'mild'
 */
export async function painCorrelation({
  days = 365,
  asOf = today(),
  highIf = null,
  severity = 'moderate',
  limit = null,
} = {}) {
  const ifThreshold = highIf ?? (await getSettingNum('high_if_threshold', 0.8));
  const threshold = severity === 'mild' ? 1 : 2;
  let rides = await loggedRides(addDays(asOf, -days + 1), asOf);
  if (limit) rides = rides.slice(0, limit);

  const withIf = rides.filter((r) => r.intensity != null);
  const highIfRides = withIf.filter((r) => r.intensity >= ifThreshold);
  const lowIfRides = withIf.filter((r) => r.intensity < ifThreshold);

  const cell = (rows, position) => {
    const sel = position ? rows.filter((r) => r.position === position) : rows;
    const hits = sel.filter((r) => isPain(r, threshold));
    return {
      position: position || 'all',
      rides: sel.length,
      painRides: hits.length,
      painRatePct: rate(hits.length, sel.length),
      meanIf: round(mean(sel.map((r) => r.intensity)), 2),
      meanVi: round(mean(sel.map((r) => r.vi)), 3),
      meanHours: round(mean(sel.map((r) => r.moving_time)) / 3600, 1),
    };
  };

  const positions = ['drops', 'mixed', 'upright'];
  const table = {
    highIf: { threshold: ifThreshold, n: highIfRides.length, byPosition: positions.map((p) => cell(highIfRides, p)), all: cell(highIfRides, null) },
    lowIf: { threshold: ifThreshold, n: lowIfRides.length, byPosition: positions.map((p) => cell(lowIfRides, p)), all: cell(lowIfRides, null) },
  };

  // --- distance control: is it really intensity+position, or just long rides?
  const byDuration = durationControl(rides, threshold);

  // --- VI: does pain track ragged pacing (surging) independent of IF?
  const painRows = rides.filter((r) => isPain(r, threshold));
  const noPainRows = rides.filter((r) => !isPain(r, threshold));
  const vi = {
    meanViWithPain: round(mean(painRows.map((r) => r.vi)), 3),
    meanViWithoutPain: round(mean(noPainRows.map((r) => r.vi)), 3),
    nPain: painRows.filter((r) => r.vi != null).length,
    nNoPain: noPainRows.filter((r) => r.vi != null).length,
  };

  // --- time in drops, when it's been logged
  const dropsPain = painRows.filter((r) => r.drops_minutes != null);
  const dropsNoPain = noPainRows.filter((r) => r.drops_minutes != null);
  const drops = {
    meanMinutesWithPain: round(mean(dropsPain.map((r) => r.drops_minutes)), 0),
    meanMinutesWithoutPain: round(mean(dropsNoPain.map((r) => r.drops_minutes)), 0),
    nPain: dropsPain.length,
    nNoPain: dropsNoPain.length,
  };

  const headline = buildHeadline(table, byDuration, severity, ifThreshold);

  return {
    window: { days, asOf, from: addDays(asOf, -days + 1) },
    severity,
    ifThreshold,
    totalLogged: rides.length,
    totalWithPain: painRows.length,
    table,
    durationControl: byDuration,
    vi,
    drops,
    headline,
    sufficient: rides.length >= 8,
    rides: rides.slice(0, 40),
  };
}

/** Split by ride duration at the median so "distance" gets a fair test. */
function durationControl(rides, threshold) {
  const withTime = rides.filter((r) => r.moving_time);
  if (withTime.length < 4) return { enough: false, n: withTime.length };
  const sorted = [...withTime].sort((a, b) => a.moving_time - b.moving_time);
  const mid = Math.floor(sorted.length / 2);
  const shortRides = sorted.slice(0, mid);
  const longRides = sorted.slice(mid);
  const summarise = (rows, label) => {
    const hits = rows.filter((r) => isPain(r, threshold));
    return {
      label,
      rides: rows.length,
      painRides: hits.length,
      painRatePct: rate(hits.length, rows.length),
      meanHours: round(mean(rows.map((r) => r.moving_time)) / 3600, 1),
      meanIf: round(mean(rows.map((r) => r.intensity)), 2),
    };
  };
  return {
    enough: true,
    splitHours: round(sorted[mid].moving_time / 3600, 1),
    shorter: summarise(shortRides, 'shorter half'),
    longer: summarise(longRides, 'longer half'),
  };
}

function buildHeadline(table, dur, severity, ifThreshold) {
  const hi = table.highIf;
  const dropsCell = hi.byPosition.find((c) => c.position === 'drops');
  const uprightCell = hi.byPosition.find((c) => c.position === 'upright');
  const word = severity === 'mild' ? 'any back pain' : 'moderate-or-worse back pain';

  if (hi.n < 4 || !dropsCell || !uprightCell || dropsCell.rides === 0) {
    return `Not enough logged rides yet to show a pattern: ${hi.n} rides at IF ≥ ${ifThreshold} have a position and pain entry. Log position + pain on every ride and this fills in — 8–10 rides is usually enough for the split to mean something.`;
  }

  const parts = [
    `Of your last ${hi.n} rides at IF ≥ ${ifThreshold}, ${word} occurred in ${dropsCell.painRides} of ${dropsCell.rides} drops rides (${dropsCell.painRatePct}%)`,
  ];
  if (uprightCell.rides > 0) {
    parts.push(`vs ${uprightCell.painRides} of ${uprightCell.rides} upright rides (${uprightCell.painRatePct}%)`);
  } else {
    parts.push('with no upright rides in that intensity band to compare against');
  }
  let s = parts.join(' ') + '.';

  const lo = table.lowIf;
  const loDrops = lo.byPosition.find((c) => c.position === 'drops');
  if (loDrops && loDrops.rides >= 2) {
    s += ` Below IF ${ifThreshold}, drops rides came in at ${loDrops.painRides}/${loDrops.rides} (${loDrops.painRatePct}%) — that contrast is the intensity component.`;
  }
  if (dur.enough) {
    s += ` Distance control: the longer half of your rides (mean ${dur.longer.meanHours}h) had a ${dur.longer.painRatePct}% pain rate vs ${dur.shorter.painRatePct}% for the shorter half (mean ${dur.shorter.meanHours}h).`;
  }
  return s;
}

/** Compact flag for the weekly brief. Returns null when there's nothing to say. */
export async function painFlag({ asOf = today(), days = 120 } = {}) {
  const c = await painCorrelation({ asOf, days });
  if (!c.sufficient) return null;
  const hi = c.table.highIf;
  const d = hi.byPosition.find((x) => x.position === 'drops');
  const u = hi.byPosition.find((x) => x.position === 'upright');
  if (!d || d.rides < 3) return null;
  const contrast = u && u.rides >= 2 ? (d.painRatePct ?? 0) - (u.painRatePct ?? 0) : null;
  if ((d.painRatePct ?? 0) < 30 && contrast == null) return null;
  return {
    severity: (d.painRatePct ?? 0) >= 50 ? 'warn' : 'info',
    title: 'Back pain / position',
    text: c.headline,
    numbers: { dropsPainRatePct: d.painRatePct, uprightPainRatePct: u?.painRatePct ?? null, ifThreshold: c.ifThreshold },
  };
}

/** Recent pain events, for the brief and the UI timeline. */
export async function recentPain({ asOf = today(), days = 42 } = {}) {
  return db
    .prepare(
      `SELECT r.date, r.back_pain, r.position, r.drops_minutes, r.pain_onset, r.notes,
              a.name, a.intensity, a.vi, a.tss, a.moving_time
       FROM ride_logs r LEFT JOIN activities a ON a.id = r.activity_id
       WHERE r.date >= ? AND r.date <= ? AND r.back_pain IN ('mild','moderate','flare')
       ORDER BY r.date DESC`
    )
    .all(addDays(asOf, -days + 1), asOf);
}

export async function upsertRideLog(log) {
  const now = new Date().toISOString();
  const existing = log.activity_id
    ? await db.prepare('SELECT * FROM ride_logs WHERE activity_id = ?').get(log.activity_id)
    : null;
  if (existing) {
    await db
      .prepare(
        `UPDATE ride_logs SET date=?, position=?, drops_minutes=?, back_pain=?, pain_onset=?, rpe=?,
        carb_g_per_h=?, protein_g=?, notes=?, source='manual', updated_at=? WHERE id=?`
      )
      .run(
        log.date ?? existing.date,
        log.position ?? existing.position,
        log.drops_minutes ?? existing.drops_minutes,
        log.back_pain ?? existing.back_pain,
        log.pain_onset ?? existing.pain_onset,
        log.rpe ?? existing.rpe,
        log.carb_g_per_h ?? existing.carb_g_per_h,
        log.protein_g ?? existing.protein_g,
        log.notes ?? existing.notes,
        now,
        existing.id
      );
    return db.prepare('SELECT * FROM ride_logs WHERE id = ?').get(existing.id);
  }
  const info = await db
    .prepare(
      `INSERT INTO ride_logs (activity_id, date, position, drops_minutes, back_pain, pain_onset, rpe,
        carb_g_per_h, protein_g, notes, source, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,'manual',?,?)`
    )
    .run(
      log.activity_id ?? null,
      log.date,
      log.position ?? null,
      log.drops_minutes ?? null,
      log.back_pain ?? null,
      log.pain_onset ?? null,
      log.rpe ?? null,
      log.carb_g_per_h ?? null,
      log.protein_g ?? null,
      log.notes ?? null,
      now,
      now
    );
  return db.prepare('SELECT * FROM ride_logs WHERE id = ?').get(Number(info.lastInsertRowid));
}
