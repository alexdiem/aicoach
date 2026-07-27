// Optional menstrual-cycle model. Everything here degrades to `null` when the
// athlete logs nothing, and the planner must stay fully functional in that case.
//
// Sources, in priority order:
//   1. daily_logs.period_start = 1  (explicit day-1 markers, most reliable)
//   2. daily_logs.cycle_phase       (explicit phase for a date)
//   3. wellness.menstrual_phase     (synced from intervals.icu)

import { db } from './db.js';
import { addDays, daysBetween, median, round, today } from './util.js';

export const PHASES = ['menstrual', 'follicular', 'ovulation', 'luteal_early', 'luteal_late'];

/** Sims groups the cycle into low-hormone and high-hormone halves. */
export const HORMONE_STATE = {
  menstrual: 'low',
  follicular: 'low',
  ovulation: 'rising',
  luteal_early: 'high',
  luteal_late: 'high',
};

const DEFAULT_CYCLE_LENGTH = 28;

export function periodStarts() {
  return db
    .prepare('SELECT date FROM daily_logs WHERE period_start = 1 ORDER BY date')
    .all()
    .map((r) => r.date);
}

export function hasCycleData() {
  const ps = db.prepare('SELECT COUNT(*) c FROM daily_logs WHERE period_start = 1').get().c;
  const ph = db.prepare("SELECT COUNT(*) c FROM daily_logs WHERE cycle_phase IS NOT NULL AND cycle_phase != ''").get().c;
  const wl = db
    .prepare("SELECT COUNT(*) c FROM wellness WHERE menstrual_phase IS NOT NULL AND menstrual_phase != ''")
    .get().c;
  return ps > 0 || ph > 0 || wl > 0;
}

/** Mean cycle length from logged day-1 markers; null if fewer than two. */
export function cycleModel() {
  const starts = periodStarts();
  if (starts.length < 2) {
    return {
      lengthDays: starts.length ? DEFAULT_CYCLE_LENGTH : null,
      lastStart: starts[starts.length - 1] || null,
      n: starts.length,
      assumed: true,
    };
  }
  const gaps = [];
  for (let i = 1; i < starts.length; i++) {
    const g = daysBetween(starts[i - 1], starts[i]);
    if (g >= 18 && g <= 45) gaps.push(g);
  }
  const len = median(gaps) || DEFAULT_CYCLE_LENGTH;
  return {
    lengthDays: Math.round(len),
    lastStart: starts[starts.length - 1],
    n: starts.length,
    assumed: gaps.length === 0,
    variability: gaps.length > 1 ? round(Math.max(...gaps) - Math.min(...gaps), 0) : null,
  };
}

function phaseFromDay(day, cycleLength) {
  const L = cycleLength || DEFAULT_CYCLE_LENGTH;
  const ovulation = Math.round(L - 14); // luteal phase is the stable ~14d half
  if (day <= 5) return 'menstrual';
  if (day < ovulation - 1) return 'follicular';
  if (day <= ovulation + 1) return 'ovulation';
  if (day <= ovulation + 7) return 'luteal_early';
  return 'luteal_late';
}

function normalisePhaseName(s) {
  if (!s) return null;
  const t = String(s).toLowerCase().replace(/[\s-]+/g, '_');
  if (PHASES.includes(t)) return t;
  if (t.includes('menstru') || t === 'period' || t === 'bleeding') return 'menstrual';
  if (t.includes('ovul')) return 'ovulation';
  if (t.includes('late') && t.includes('luteal')) return 'luteal_late';
  if (t.includes('luteal')) return 'luteal_early';
  if (t.includes('follic')) return 'follicular';
  return null;
}

/**
 * Best-effort phase for a date. `source` tells the UI (and the brief) how much
 * to trust it: 'logged' > 'wellness' > 'predicted'.
 */
export function phaseFor(date) {
  const log = db.prepare('SELECT cycle_phase, cycle_day FROM daily_logs WHERE date = ?').get(date);
  if (log?.cycle_phase) {
    return { date, phase: normalisePhaseName(log.cycle_phase), day: log.cycle_day ?? null, source: 'logged' };
  }
  const well = db.prepare('SELECT menstrual_phase, menstrual_predicted FROM wellness WHERE date = ?').get(date);
  if (well?.menstrual_phase) {
    const p = normalisePhaseName(well.menstrual_phase);
    if (p) return { date, phase: p, day: null, source: 'wellness' };
  }

  const model = cycleModel();
  if (!model.lastStart) {
    if (well?.menstrual_predicted) {
      const p = normalisePhaseName(well.menstrual_predicted);
      if (p) return { date, phase: p, day: null, source: 'wellness-predicted' };
    }
    return { date, phase: null, day: null, source: 'none' };
  }
  const L = model.lengthDays || DEFAULT_CYCLE_LENGTH;
  const delta = daysBetween(model.lastStart, date);
  if (delta < 0) return { date, phase: null, day: null, source: 'none' };
  const day = (delta % L) + 1;
  return {
    date,
    phase: phaseFromDay(day, L),
    day,
    source: 'predicted',
    cyclesAhead: Math.floor(delta / L),
    cycleLength: L,
  };
}

/** Dominant phase across a week, with the per-day detail kept for the UI. */
export function phaseForWeek(weekStartDate) {
  const days = [];
  for (let i = 0; i < 7; i++) days.push(phaseFor(addDays(weekStartDate, i)));
  const counts = new Map();
  for (const d of days) {
    if (!d.phase) continue;
    counts.set(d.phase, (counts.get(d.phase) || 0) + 1);
  }
  if (!counts.size) return { weekStart: weekStartDate, phase: null, days, confidence: 'none' };
  let best = null;
  for (const [phase, c] of counts) if (!best || c > best.c) best = { phase, c };
  const anyLogged = days.some((d) => d.source === 'logged' || d.source === 'wellness');
  return {
    weekStart: weekStartDate,
    phase: best.phase,
    daysInPhase: best.c,
    hormoneState: HORMONE_STATE[best.phase] || null,
    days,
    confidence: anyLogged ? 'logged' : 'predicted',
  };
}

/**
 * Sims-derived training adjustments for a phase. Returned as multipliers and
 * text so the planner can apply them and the brief can explain them.
 */
export function simsAdjustment(phase) {
  switch (phase) {
    case 'menstrual':
      return {
        phase,
        hormone: 'low',
        tssMultiplier: 1.0,
        intensityShift: 0,
        favourQuality: true,
        notes: [
          'Low-hormone phase: nervous-system recruitment and carbohydrate use are near-optimal — this is a good window for the hardest quality work, symptoms permitting.',
          'Iron losses are highest here; if ferritin has ever been low, this is the week it shows up as flat top-end power.',
        ],
        fuelling: ['Standard carbohydrate intake for the session; no luteal-phase surcharge needed.'],
      };
    case 'follicular':
      return {
        phase,
        hormone: 'low',
        tssMultiplier: 1.05,
        intensityShift: +1,
        favourQuality: true,
        notes: [
          'Late follicular is the highest-adaptation window for intensity and heavy strength: place VO2/threshold blocks and PR attempts here.',
        ],
        fuelling: ['Carb tolerance is highest here — fuel intensity sessions normally (60–90 g/h on long efforts).'],
      };
    case 'ovulation':
      return {
        phase,
        hormone: 'rising',
        tssMultiplier: 1.0,
        intensityShift: 0,
        favourQuality: true,
        notes: [
          'Oestrogen peak: strength output is high, but connective-tissue laxity is highest around ovulation — keep loaded lifting technically clean and avoid new max-effort lifts.',
        ],
        fuelling: ['Standard fuelling.'],
      };
    case 'luteal_early':
      return {
        phase,
        hormone: 'high',
        tssMultiplier: 0.95,
        intensityShift: -1,
        favourQuality: false,
        notes: [
          'High-hormone phase: core temperature runs ~0.3–0.5 °C higher and plasma volume drops, so the same power costs more heart rate and feels harder.',
          'Central fatigue and reduced carbohydrate availability blunt top-end work — hold volume, trim the hardest intervals.',
        ],
        fuelling: [
          'Pre-fuel before every session (30 g carbohydrate) — do not train fasted in this phase.',
          'Add 30–40 g protein within 30 min post-session to offset the catabolic effect of progesterone.',
          'Increase sodium: plasma volume is lower, so hydrate with electrolytes rather than plain water.',
        ],
      };
    case 'luteal_late':
      return {
        phase,
        hormone: 'high',
        tssMultiplier: 0.9,
        intensityShift: -1,
        favourQuality: false,
        notes: [
          'Late luteal (premenstrual) is the hardest week to hit intensity targets: highest core temp, lowest plasma volume, poorest sleep quality.',
          'Judge sessions by power/pace targets, not heart rate — HR will read high for the same work.',
        ],
        fuelling: [
          'Pre-fuel every session and raise carbohydrate intake around hard work; appetite signals are unreliable here.',
          '30–40 g protein pre-bed supports overnight repair when progesterone is high.',
          'Sodium and fluid up; heat sessions and hot races are meaningfully harder in this phase.',
        ],
      };
    default:
      return null;
  }
}

export function cycleSummary(date = today()) {
  if (!hasCycleData()) return { enabled: false };
  const model = cycleModel();
  const now = phaseFor(date);
  return {
    enabled: true,
    model,
    current: now,
    adjustment: now.phase ? simsAdjustment(now.phase) : null,
  };
}
