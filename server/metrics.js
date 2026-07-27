// Derived training metrics: CTL/ATL/TSB, EF trend, VI drift, W'bal recovery,
// intensity distribution, and plan-vs-actual compliance.
//
// Every value here is meant to be quotable in a brief, so functions return the
// inputs alongside the result (n, window, thresholds) rather than a bare number.
//
// All DB-touching functions here are async (the storage layer may be a
// networked DB on Vercel — see dbdriver.js). Independent queries are fired
// with Promise.all rather than awaited one at a time, since a remote DB's
// round-trip is the dominant cost once it's no longer a local file.

import { db, getSettingNum } from './db.js';
import { addDays, daysBetween, isoDate, mean, pctChange, round, sum, today, weekStart } from './util.js';

const CTL_TAU = 42;
const ATL_TAU = 7;

export async function activitiesBetween(from, to) {
  return db.prepare('SELECT * FROM activities WHERE date >= ? AND date <= ? ORDER BY date, start_local').all(from, to);
}

export async function dailyLoad(from, to) {
  const rows = await db
    .prepare('SELECT date, SUM(COALESCE(tss,0)) AS tss FROM activities WHERE date >= ? AND date <= ? GROUP BY date')
    .all(from, to);
  const map = new Map();
  for (const r of rows) map.set(r.date, r.tss || 0);
  return map;
}

/**
 * Daily fitness series. intervals.icu's own CTL/ATL wins when present for a
 * date (it is the number shown in the app the athlete looks at); otherwise we
 * continue the standard exponential model from the last known point.
 */
export async function fitnessSeries(from, to) {
  const start = addDays(from, -180);
  const [loads, wellnessRows, seed] = await Promise.all([
    dailyLoad(start, to),
    db.prepare('SELECT date, ctl, atl FROM wellness WHERE date >= ? AND date <= ?').all(start, to),
    db.prepare('SELECT ctl, atl FROM wellness WHERE date <= ? AND ctl IS NOT NULL ORDER BY date DESC LIMIT 1').get(start),
  ]);
  const wellness = new Map(wellnessRows.map((r) => [r.date, r]));

  const n = daysBetween(start, to);
  let ctl = 0;
  let atl = 0;
  if (seed) {
    ctl = seed.ctl || 0;
    atl = seed.atl || 0;
  }

  const out = [];
  for (let i = 0; i <= n; i++) {
    const date = addDays(start, i);
    const load = loads.get(date) || 0;
    const prevCtl = ctl;
    const prevAtl = atl;
    const w = wellness.get(date);
    if (w && w.ctl != null) {
      ctl = w.ctl;
      atl = w.atl != null ? w.atl : prevAtl + (load - prevAtl) / ATL_TAU;
    } else {
      ctl = prevCtl + (load - prevCtl) / CTL_TAU;
      atl = prevAtl + (load - prevAtl) / ATL_TAU;
    }
    if (date >= from) {
      out.push({
        date,
        load,
        ctl: round(ctl, 1),
        atl: round(atl, 1),
        // Form is yesterday's fitness minus yesterday's fatigue (the
        // TrainingPeaks/intervals.icu convention, so the number matches what
        // intervals.icu shows). Keep the pair it was derived from: quoting
        // today's CTL/ATL beside yesterday's TSB makes the arithmetic not add up.
        tsb: round(prevCtl - prevAtl, 1),
        ctlPrev: round(prevCtl, 1),
        atlPrev: round(prevAtl, 1),
        source: w && w.ctl != null ? 'intervals' : 'computed',
      });
    }
  }
  return out;
}

export async function currentFitness(date = today()) {
  const series = await fitnessSeries(addDays(date, -7), date);
  return series[series.length - 1] || { date, ctl: 0, atl: 0, tsb: 0, source: 'none' };
}

/** CTL change over the last 7 days = ramp rate (CTL points/week). */
export async function rampRate(date = today()) {
  const series = await fitnessSeries(addDays(date, -8), date);
  if (series.length < 8) return null;
  const now = series[series.length - 1].ctl;
  const then = series[0].ctl;
  return round(now - then, 1);
}

// --- Efficiency Factor ------------------------------------------------------

/**
 * EF samples restricted to an aerobic IF band and a minimum duration, so we
 * compare like with like. Comparing EF across a sprint and a 6h endurance ride
 * is meaningless; comparing steady rides at IF 0.55-0.88 is not.
 */
export async function efSamples(from, to, opts = {}) {
  const [defIfMin, defIfMax, defMinMin] = await Promise.all([
    getSettingNum('ef_if_min', 0.55),
    getSettingNum('ef_if_max', 0.88),
    getSettingNum('ef_min_minutes', 45),
  ]);
  const ifMin = opts.ifMin ?? defIfMin;
  const ifMax = opts.ifMax ?? defIfMax;
  const minMin = opts.minMinutes ?? defMinMin;
  return db
    .prepare(
      `SELECT id, date, name, type, ef, intensity, np, avg_hr, vi, moving_time, tss
       FROM activities
       WHERE date >= ? AND date <= ? AND ef IS NOT NULL AND ef > 0
         AND intensity >= ? AND intensity <= ? AND moving_time >= ?
       ORDER BY date`
    )
    .all(from, to, ifMin, ifMax, minMin * 60);
}

/**
 * EF trend: mean EF of the recent window vs the preceding baseline window,
 * both IF-matched. Negative pct = aerobic decoupling / accumulating fatigue.
 */
export async function efTrend(date = today(), recentDays = 21, baselineDays = 42) {
  const [recent, baseline] = await Promise.all([
    efSamples(addDays(date, -recentDays + 1), date),
    efSamples(addDays(date, -recentDays - baselineDays + 1), addDays(date, -recentDays)),
  ]);
  const recentMean = mean(recent.map((r) => r.ef));
  const baseMean = mean(baseline.map((r) => r.ef));
  const change = pctChange(recentMean, baseMean);
  return {
    recentMean: round(recentMean, 3),
    baselineMean: round(baseMean, 3),
    changePct: round(change, 1),
    recentN: recent.length,
    baselineN: baseline.length,
    recentDays,
    baselineDays,
    recentIfMean: round(mean(recent.map((r) => r.intensity)), 2),
    baselineIfMean: round(mean(baseline.map((r) => r.intensity)), 2),
    // Only trust the comparison when both windows have enough IF-matched rides
    // and the mean IF didn't shift much between them.
    reliable:
      recent.length >= 3 &&
      baseline.length >= 3 &&
      Math.abs((mean(recent.map((r) => r.intensity)) || 0) - (mean(baseline.map((r) => r.intensity)) || 0)) <= 0.06,
  };
}

// --- Variability index ------------------------------------------------------

/** Steady rides (IF below threshold) whose VI exceeds a ceiling = ragged pacing. */
export async function viDrift(from, to, { ifMax = 0.78, viCeiling = 1.1, minMinutes = 60 } = {}) {
  const rows = await db
    .prepare(
      `SELECT id, date, name, vi, intensity, np, avg_power, moving_time, elevation_m
       FROM activities
       WHERE date >= ? AND date <= ? AND vi IS NOT NULL AND intensity IS NOT NULL
         AND intensity <= ? AND moving_time >= ?
       ORDER BY date`
    )
    .all(from, to, ifMax, minMinutes * 60);
  const offenders = rows.filter((r) => r.vi > viCeiling);
  return {
    n: rows.length,
    offenders,
    meanVi: round(mean(rows.map((r) => r.vi)), 3),
    ifMax,
    viCeiling,
  };
}

// --- W'bal ------------------------------------------------------------------

/**
 * Interval sessions and how deep into W' they went. If the same session shape
 * costs progressively more W' at the same NP, anaerobic capacity is not
 * recovering between sessions.
 */
export async function wbalSessions(from, to, { minIf = 0.82 } = {}) {
  return db
    .prepare(
      `SELECT id, date, name, wbal_drop, wbal_min, w_prime, intensity, np, tss, moving_time
       FROM activities
       WHERE date >= ? AND date <= ? AND wbal_drop IS NOT NULL AND intensity >= ?
       ORDER BY date`
    )
    .all(from, to, minIf);
}

export async function wbalRecoveryFlag(date = today(), days = 28) {
  const rows = await wbalSessions(addDays(date, -days + 1), date);
  if (rows.length < 3) return { enough: false, n: rows.length, rows };
  const half = Math.floor(rows.length / 2);
  const older = rows.slice(0, half);
  const newer = rows.slice(half);
  const oldDrop = mean(older.map((r) => r.wbal_drop));
  const newDrop = mean(newer.map((r) => r.wbal_drop));
  const oldNp = mean(older.map((r) => r.np));
  const newNp = mean(newer.map((r) => r.np));
  return {
    enough: true,
    n: rows.length,
    rows,
    olderMeanDropKj: round(oldDrop / 1000, 1),
    newerMeanDropKj: round(newDrop / 1000, 1),
    dropChangePct: round(pctChange(newDrop, oldDrop), 1),
    olderMeanNp: round(oldNp, 0),
    newerMeanNp: round(newNp, 0),
    npChangePct: round(pctChange(newNp, oldNp), 1),
  };
}

// --- Intensity distribution -------------------------------------------------

/**
 * Percent of moving time in three bands, from power zone times when available,
 * HR zone times next, and a whole-activity IF classification as a last resort.
 * Bands: Z1-2 (below LT1), Z3-4 (tempo/threshold), Z5+ (VO2 and above).
 */
export async function intensityDistribution(from, to) {
  const acts = await activitiesBetween(from, to);
  let low = 0;
  let mid = 0;
  let high = 0;
  let classified = 0;
  let fallback = 0;

  for (const a of acts) {
    const secs = a.moving_time || 0;
    if (!secs) continue;
    const z = safeArray(a.z_times_json) || safeArray(a.hr_z_times_json);
    if (z && z.length >= 5) {
      const vals = z.map((x) => (typeof x === 'object' ? x.secs ?? x.time ?? 0 : x || 0));
      low += (vals[0] || 0) + (vals[1] || 0);
      mid += (vals[2] || 0) + (vals[3] || 0);
      high += vals.slice(4).reduce((s, v) => s + (v || 0), 0);
      classified += secs;
    } else if (a.intensity != null) {
      if (a.intensity < 0.75) low += secs;
      else if (a.intensity < 0.95) mid += secs;
      else high += secs;
      fallback += secs;
      classified += secs;
    }
  }
  const total = low + mid + high;
  return {
    seconds: { low, mid, high, total },
    z1_2_pct: total ? round((low / total) * 100, 1) : null,
    z3_4_pct: total ? round((mid / total) * 100, 1) : null,
    z5_pct: total ? round((high / total) * 100, 1) : null,
    fallbackShare: classified ? round((fallback / classified) * 100, 0) : 0,
  };
}

function safeArray(json) {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// --- Weekly rollups ---------------------------------------------------------

export async function weekActuals(ws) {
  const we = addDays(ws, 6);
  const [acts, dist] = await Promise.all([activitiesBetween(ws, we), intensityDistribution(ws, we)]);
  const longest = acts.reduce((m, a) => ((a.moving_time || 0) > (m?.moving_time || 0) ? a : m), null);
  return {
    weekStart: ws,
    weekEnd: we,
    tss: round(sum(acts.map((a) => a.tss)), 0),
    hours: round(sum(acts.map((a) => a.moving_time)) / 3600, 1),
    sessions: acts.length,
    elevation_m: round(sum(acts.map((a) => a.elevation_m)), 0),
    distance_km: round(sum(acts.map((a) => a.distance_m)) / 1000, 0),
    longestHours: longest ? round(longest.moving_time / 3600, 1) : 0,
    longestTss: longest ? round(longest.tss, 0) : 0,
    distribution: dist,
    activities: acts,
  };
}

/** Weekly actuals for the N complete weeks ending with the week of `date`. Independent, so fetched in parallel. */
export async function recentWeeks(date = today(), n = 8) {
  const cur = weekStart(date);
  const weeks = [];
  for (let i = n - 1; i >= 0; i--) weeks.push(addDays(cur, -7 * i));
  return Promise.all(weeks.map((ws) => weekActuals(ws)));
}

/** Pure comparison, no DB access — stays synchronous. */
export function compareWeek(planWeek, actual) {
  if (!planWeek) return null;
  const tssDelta = (actual.tss || 0) - (planWeek.target_tss || 0);
  const tssPct = planWeek.target_tss ? ((actual.tss || 0) / planWeek.target_tss) * 100 : null;
  const d = actual.distribution;
  return {
    plannedTss: round(planWeek.target_tss, 0),
    actualTss: round(actual.tss, 0),
    tssDelta: round(tssDelta, 0),
    tssPct: round(tssPct, 0),
    plannedHours: round(planWeek.target_hours, 1),
    actualHours: round(actual.hours, 1),
    distribution: {
      planned: { z1_2: planWeek.z1_2_pct, z3_4: planWeek.z3_4_pct, z5: planWeek.z5_pct },
      actual: { z1_2: d.z1_2_pct, z3_4: d.z3_4_pct, z5: d.z5_pct },
      z1_2Delta: d.z1_2_pct == null ? null : round(d.z1_2_pct - planWeek.z1_2_pct, 1),
      z3_4Delta: d.z3_4_pct == null ? null : round(d.z3_4_pct - planWeek.z3_4_pct, 1),
      z5Delta: d.z5_pct == null ? null : round(d.z5_pct - planWeek.z5_pct, 1),
    },
    longSession: {
      plannedHours: round(planWeek.long_session_h, 1),
      actualHours: actual.longestHours,
      deltaHours: round((actual.longestHours || 0) - (planWeek.long_session_h || 0), 1),
    },
  };
}

// --- Nutrition / RED-S support (optional, only if the athlete logs it) ------

export async function fuellingSignals(date = today(), days = 28) {
  const from = addDays(date, -days + 1);
  const [w, logs] = await Promise.all([
    db
      .prepare(`SELECT date, weight, resting_hr, hrv, kcal_consumed FROM wellness WHERE date >= ? AND date <= ? ORDER BY date`)
      .all(from, date),
    db.prepare('SELECT date, intake_kcal, protein_g FROM daily_logs WHERE date >= ? AND date <= ? ORDER BY date').all(from, date),
  ]);

  const half = Math.floor(w.length / 2);
  const weightEarly = mean(w.slice(0, half).map((r) => r.weight));
  const weightLate = mean(w.slice(half).map((r) => r.weight));
  const rhrEarly = mean(w.slice(0, half).map((r) => r.resting_hr));
  const rhrLate = mean(w.slice(half).map((r) => r.resting_hr));
  const hrvEarly = mean(w.slice(0, half).map((r) => r.hrv));
  const hrvLate = mean(w.slice(half).map((r) => r.hrv));

  const intake = logs.map((r) => r.intake_kcal).filter((x) => x != null);
  const wellnessIntake = w.map((r) => r.kcal_consumed).filter((x) => x != null);
  const protein = logs.map((r) => r.protein_g).filter((x) => x != null);

  return {
    days,
    weightChangePct: round(pctChange(weightLate, weightEarly), 2),
    weightLate: round(weightLate, 1),
    rhrChange: round((rhrLate ?? 0) - (rhrEarly ?? 0), 1),
    rhrLate: round(rhrLate, 0),
    hrvChangePct: round(pctChange(hrvLate, hrvEarly), 1),
    intakeMean: round(mean(intake.length ? intake : wellnessIntake), 0),
    intakeN: intake.length || wellnessIntake.length,
    proteinMean: round(mean(protein), 0),
    proteinN: protein.length,
    hasIntakeData: (intake.length || wellnessIntake.length) >= 5,
  };
}
