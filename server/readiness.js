// Daily readiness check: today's HRV, resting HR and sleep against the
// athlete's own recent baseline. Same house rule as brief.js and debrief.js —
// only speaks when a number crosses a line — but "today" rather than "this
// week", using whatever wellness sync already pulled in from intervals.icu.
//
// Deliberately does NOT score soreness/fatigue/stress/mood/motivation/injury/
// readiness. Those come from intervals.icu as a 1-4/1-5 subjective survey, and
// this app couldn't get a confident read on which direction of that scale is
// "better" from intervals.icu's public docs (blocked to automated fetches at
// the time this was written) — asserting a threshold on a scale whose
// direction isn't verified risks giving backwards recovery advice, which is
// worse than saying nothing. They're returned as plain numbers for the UI to
// display, unscored, until that's confirmed.

import { db } from './db.js';
import { addDays, daysBetween, mean, pctChange, round, signed, today } from './util.js';

const SEV_ORDER = { critical: 0, warn: 1, info: 2, good: 3 };

const SUBJECTIVE_FIELDS = ['soreness', 'fatigue', 'stress', 'mood', 'motivation', 'injury', 'readiness'];

async function latestWellnessRow(asOf) {
  const row = await db.prepare('SELECT * FROM wellness WHERE date <= ? ORDER BY date DESC LIMIT 1').get(asOf);
  if (!row) return null;
  // A wellness row more than a couple of days stale isn't "today" — showing
  // it as if it were would be worse than saying there's no data yet.
  if (daysBetween(row.date, asOf) > 2) return null;
  return row;
}

async function baselineRows(beforeDate, days = 21) {
  return db
    .prepare('SELECT * FROM wellness WHERE date >= ? AND date < ? ORDER BY date')
    .all(addDays(beforeDate, -days), beforeDate);
}

function checkHrv(latest, baseline, flags) {
  if (latest.hrv == null) return;
  const base = baseline.map((r) => r.hrv).filter((x) => x != null);
  if (base.length < 5) return;
  const baseMean = mean(base);
  const changePct = pctChange(latest.hrv, baseMean);
  if (changePct == null) return;
  if (changePct <= -15) {
    flags.push({
      id: 'hrv-low',
      severity: changePct <= -25 ? 'critical' : 'warn',
      title: 'HRV below baseline',
      text: `HRV ${round(latest.hrv, 0)} vs a ${round(baseMean, 0)} baseline from the last ${base.length} days (${signed(changePct)}%). A drop this size usually shows up before RPE or power do — the earliest signal of accumulated fatigue, illness, or life stress, not a training-specific one.`,
      numbers: { hrv: latest.hrv, baseline: round(baseMean, 0), changePct, n: base.length },
    });
  } else if (changePct >= 15) {
    flags.push({
      id: 'hrv-high',
      severity: 'good',
      title: 'HRV above baseline',
      text: `HRV ${round(latest.hrv, 0)} vs a ${round(baseMean, 0)} baseline (${signed(changePct)}%) — a good sign for taking on load today.`,
      numbers: { hrv: latest.hrv, baseline: round(baseMean, 0), changePct, n: base.length },
    });
  }
}

function checkRestingHr(latest, baseline, flags) {
  if (latest.resting_hr == null) return;
  const base = baseline.map((r) => r.resting_hr).filter((x) => x != null);
  if (base.length < 5) return;
  const baseMean = mean(base);
  const delta = latest.resting_hr - baseMean;
  if (delta >= 5) {
    flags.push({
      id: 'rhr-elevated',
      severity: delta >= 8 ? 'warn' : 'info',
      title: 'Resting HR elevated',
      text: `Resting HR ${round(latest.resting_hr, 0)} vs a ${round(baseMean, 0)} baseline (${signed(delta, 0)} bpm) — worth reading as a possible illness or overreaching signal, especially alongside anything else flagged here today.`,
      numbers: { restingHr: latest.resting_hr, baseline: round(baseMean, 0), delta: round(delta, 0), n: base.length },
    });
  }
}

function checkSleep(latest, flags) {
  if (latest.sleep_secs == null) return;
  const hours = latest.sleep_secs / 3600;
  if (hours < 6) {
    flags.push({
      id: 'sleep-short',
      severity: hours < 5 ? 'warn' : 'info',
      title: 'Short sleep',
      text: `${round(hours, 1)}h logged last night. Recovery from yesterday's load and today's session both lean on this — a reasonable case for treating today as easier than the plan says if it's calling for anything hard.`,
      numbers: { hours: round(hours, 1) },
    });
  }
}

function buildHeadline(latest, flags) {
  const worst = flags.find((f) => f.severity === 'critical' || f.severity === 'warn');
  if (worst) return worst.title;
  const good = flags.find((f) => f.severity === 'good');
  if (good) return good.title;
  const bits = [];
  if (latest.hrv != null) bits.push(`HRV ${round(latest.hrv, 0)}`);
  if (latest.resting_hr != null) bits.push(`RHR ${round(latest.resting_hr, 0)}`);
  if (latest.sleep_secs != null) bits.push(`sleep ${round(latest.sleep_secs / 3600, 1)}h`);
  return bits.length ? `${bits.join(' · ')} — nothing to flag.` : 'Nothing to flag today.';
}

export async function dailyReadiness(asOf = today()) {
  const latest = await latestWellnessRow(asOf);
  if (!latest) {
    return { date: asOf, hasData: false, flags: [], headline: null, subjective: null };
  }

  const baseline = await baselineRows(latest.date);
  const flags = [];
  checkHrv(latest, baseline, flags);
  checkRestingHr(latest, baseline, flags);
  checkSleep(latest, flags);
  flags.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  const subjective = {};
  for (const f of SUBJECTIVE_FIELDS) subjective[f] = latest[f] ?? null;
  const hasSubjective = Object.values(subjective).some((v) => v != null);

  return {
    date: latest.date,
    hasData: true,
    hrv: latest.hrv,
    restingHr: latest.resting_hr,
    sleepHours: latest.sleep_secs != null ? round(latest.sleep_secs / 3600, 1) : null,
    sleepScore: latest.sleep_score,
    subjective: hasSubjective ? subjective : null,
    flags,
    headline: buildHeadline(latest, flags),
  };
}
