// Per-workout coach's debrief: a short, numbers-first read of one completed
// activity against the athlete's own recent baseline and, where a plan is
// active, against this week's targets. Same house rule as the weekly brief
// (brief.js) — every claim names the number that drove it — just scoped to a
// single ride instead of a week. Computed on demand rather than stored: it's
// a handful of indexed queries against data that's already there, and storing
// one row per activity would need its own invalidation story for no benefit.

import { db, getSettingNum } from './db.js';
import { addDays, mean, pctChange, round, signed, weekStart } from './util.js';
import { efSamples, wbalSessions, activitiesBetween } from './metrics.js';
import { activeGoal, activePlan, weekForDate } from './planner.js';

const SEV_ORDER = { critical: 0, warn: 1, info: 2, good: 3 };

export async function buildWorkoutDebrief(activityId) {
  const activity = await db.prepare('SELECT * FROM activities WHERE id = ?').get(activityId);
  if (!activity) return null;

  const ws = weekStart(activity.date);
  const we = addDays(ws, 6);

  const [rideLog, goal, weekActs] = await Promise.all([
    db.prepare('SELECT * FROM ride_logs WHERE activity_id = ?').get(activityId),
    activeGoal(),
    activitiesBetween(ws, we),
  ]);
  const plan = goal ? await activePlan(goal.id) : null;
  const week = plan ? await weekForDate(plan.id, activity.date) : null;

  const longestOfWeek = weekActs.reduce((m, x) => ((x.moving_time || 0) > (m?.moving_time || 0) ? x : m), null);
  const role = classifyRole(activity, longestOfWeek?.id === activity.id);

  const flags = [];
  await Promise.all([
    checkEfficiency(activity, flags),
    checkPacing(activity, flags),
    checkWbal(activity, flags),
  ]);
  checkDecoupling(activity, flags);
  checkRpe(activity, rideLog, flags);
  checkBackPain(rideLog, flags);
  checkAgainstPlan(activity, role, week, weekActs, goal, flags);

  flags.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  const headline = buildHeadline(activity, role, flags);
  const body = renderMarkdown({ activity, role, week, goal, flags, headline });

  return {
    activityId: activity.id,
    date: activity.date,
    name: activity.name,
    type: activity.type,
    role,
    headline,
    body,
    flags,
    generatedAt: new Date().toISOString(),
  };
}

function classifyRole(a, isLongestOfWeek) {
  const type = (a.type || '').toLowerCase();
  if (/weight|strength/.test(type)) return 'strength';
  const hours = (a.moving_time || 0) / 3600;
  if (isLongestOfWeek && hours >= 1.5) return 'long';
  if (a.intensity != null && a.intensity >= 0.85) return 'key-intensity';
  if (a.intensity != null && a.intensity < 0.65 && hours < 1.25) return 'recovery';
  return 'endurance';
}

/** This ride's EF against the athlete's own trailing baseline, IF-matched — the
 * same comparison efTrend makes across weeks, just anchored on one ride. */
async function checkEfficiency(a, flags) {
  if (a.ef == null || a.ef <= 0 || a.intensity == null) return;
  const [ifMin, ifMax, minMin] = await Promise.all([
    getSettingNum('ef_if_min', 0.55),
    getSettingNum('ef_if_max', 0.88),
    getSettingNum('ef_min_minutes', 45),
  ]);
  if (a.intensity < ifMin || a.intensity > ifMax || (a.moving_time || 0) < minMin * 60) return;

  const baseline = await efSamples(addDays(a.date, -90), addDays(a.date, -1), { ifMin, ifMax, minMinutes: minMin });
  if (baseline.length < 5) return;
  const baseIf = mean(baseline.map((r) => r.intensity));
  if (Math.abs(a.intensity - (baseIf ?? a.intensity)) > 0.06) return; // not IF-matched enough to trust

  const baseEf = mean(baseline.map((r) => r.ef));
  const changePct = pctChange(a.ef, baseEf);
  if (changePct == null) return;

  if (changePct <= -5) {
    flags.push({
      id: 'ef',
      severity: changePct <= -8 ? 'warn' : 'info',
      title: 'Efficiency below baseline',
      text: `EF ${round(a.ef, 3)} at IF ${round(a.intensity, 2)}, vs a ${round(baseEf, 3)} baseline from ${baseline.length} similarly-paced rides in the last 90 days (${signed(changePct)}%). Same power costing more heart rate than usual, at matched intensity.`,
      numbers: { ef: a.ef, baseline: round(baseEf, 3), changePct, n: baseline.length },
    });
  } else if (changePct >= 5) {
    flags.push({
      id: 'ef-good',
      severity: 'good',
      title: 'Efficiency above baseline',
      text: `EF ${round(a.ef, 3)} at IF ${round(a.intensity, 2)}, vs a ${round(baseEf, 3)} baseline (${signed(changePct)}%) — the aerobic engine did more with the same effort than it usually does.`,
      numbers: { ef: a.ef, baseline: round(baseEf, 3), changePct, n: baseline.length },
    });
  }
}

/** Ragged pacing on a steady ride — same threshold viDrift uses across a week,
 * applied to this one ride. */
function checkPacing(a, flags) {
  const ifMax = 0.78;
  const viCeiling = 1.1;
  const minMinutes = 60;
  if (a.vi == null || a.intensity == null || a.intensity > ifMax || (a.moving_time || 0) < minMinutes * 60) return;
  if (a.vi > viCeiling) {
    flags.push({
      id: 'vi',
      severity: 'warn',
      title: 'Ragged pacing',
      text: `VI ${round(a.vi, 2)} at IF ${round(a.intensity, 2)} — above the ${viCeiling} ceiling for a steady ride. On a planned endurance ride this usually means surging replaced steady output, which raises fatigue without raising fitness as efficiently.`,
      numbers: { vi: a.vi, viCeiling, intensity: a.intensity },
    });
  }
}

/** W' consumed on this ride vs the athlete's own recent trailing mean at
 * similar NP — the single-ride version of the weekly W'bal-recovery flag. */
async function checkWbal(a, flags) {
  const minIf = 0.82;
  if (a.wbal_drop == null || a.intensity == null || a.intensity < minIf) return;
  const baseline = await wbalSessions(addDays(a.date, -28), addDays(a.date, -1), { minIf });
  if (baseline.length < 3) return;
  const baseDrop = mean(baseline.map((r) => r.wbal_drop));
  const baseNp = mean(baseline.map((r) => r.np));
  if (baseDrop == null || !baseNp || a.np == null) return;
  const dropChangePct = pctChange(a.wbal_drop, baseDrop);
  const npChangePct = pctChange(a.np, baseNp);
  if (dropChangePct != null && dropChangePct > 15 && Math.abs(npChangePct ?? 0) < 5) {
    flags.push({
      id: 'wbal',
      severity: 'warn',
      title: "W' consumed deeper than usual",
      text: `${round(a.wbal_drop / 1000, 1)} kJ of W' consumed at NP ${round(a.np, 0)} W, vs a ${round(baseDrop / 1000, 1)} kJ mean from ${baseline.length} similar-intensity sessions in the last 28 days at essentially the same NP (${signed(npChangePct, 1)}%). Same work costing more of the anaerobic tank than usual.`,
      numbers: { dropKj: round(a.wbal_drop / 1000, 1), baselineKj: round(baseDrop / 1000, 1), dropChangePct, np: a.np, baselineNp: round(baseNp, 0) },
    });
  }
}

/** Aerobic decoupling within the ride itself (Pw:Hr drift), independent of the
 * cross-ride EF trend above. */
function checkDecoupling(a, flags) {
  if (a.decoupling == null || (a.moving_time || 0) < 60 * 60) return;
  if (a.decoupling > 8) {
    flags.push({
      id: 'decoupling',
      severity: a.decoupling > 12 ? 'warn' : 'info',
      title: 'Aerobic decoupling within the ride',
      text: `Power:HR drifted ${round(a.decoupling, 1)}% over the ride — above the ~5% that's usually considered well-controlled aerobic pacing. Worth checking hydration, fuelling and heat for this one before reading it as a fitness signal.`,
      numbers: { decoupling: a.decoupling },
    });
  }
}

/** Logged perceived effort vs the numbers. A soft, framed-as-an-observation
 * check — RPE is subjective, so this never asserts more than the gap itself. */
function checkRpe(a, rideLog, flags) {
  const rpe = rideLog?.rpe;
  if (rpe == null || a.intensity == null) return;
  const expectedIf = 0.5 + rpe * 0.045; // RPE 1 → ~0.545, RPE 10 → ~0.95
  const gap = a.intensity - expectedIf;
  if (gap <= -0.12) {
    flags.push({
      id: 'rpe-harder',
      severity: 'info',
      title: 'Felt harder than the numbers show',
      text: `Logged RPE ${rpe}/10 against IF ${round(a.intensity, 2)}, lower than the effort that RPE usually goes with. Could be heat, sleep, stress, or something not showing up in power/HR — worth a mental note rather than a training change on its own.`,
      numbers: { rpe, intensity: a.intensity, expectedIf: round(expectedIf, 2) },
    });
  } else if (gap >= 0.12) {
    flags.push({
      id: 'rpe-easier',
      severity: 'info',
      title: 'Felt easier than the numbers show',
      text: `Logged RPE ${rpe}/10 against IF ${round(a.intensity, 2)}, higher output than that RPE usually goes with — a good sign the fitness underneath this effort is ahead of how it felt.`,
      numbers: { rpe, intensity: a.intensity, expectedIf: round(expectedIf, 2) },
    });
  }
}

function checkBackPain(rideLog, flags) {
  if (!rideLog?.back_pain || rideLog.back_pain === 'none') return;
  flags.push({
    id: 'back-pain',
    severity: rideLog.back_pain === 'flare' ? 'warn' : 'info',
    title: 'Back pain logged',
    text: `Logged as ${rideLog.back_pain}${rideLog.position ? `, position ${rideLog.position}` : ''}${rideLog.drops_minutes ? `, ${round(rideLog.drops_minutes, 0)} min in the drops` : ''}${rideLog.pain_onset ? `, onset ${rideLog.pain_onset}` : ''}.`,
    numbers: { back_pain: rideLog.back_pain },
  });
}

/** How this ride fits the active plan's week — role-specific, and quiet when
 * there's no active goal/plan to compare against. */
function checkAgainstPlan(a, role, week, weekActs, goal, flags) {
  if (!week) return;
  const hours = (a.moving_time || 0) / 3600;
  const tssSoFar = round(weekActs.reduce((s, x) => s + (x.tss || 0), 0), 0);

  if (role === 'long' && week.long_session_h) {
    const delta = hours - week.long_session_h;
    if (Math.abs(delta) > 0.75) {
      flags.push({
        id: 'long-vs-plan',
        severity: delta < 0 ? 'warn' : 'info',
        title: 'Long session vs plan',
        text: `${round(hours, 1)}h against a ${week.long_session_h}h long session planned for this ${week.phase} week (${signed(delta, 1)}h). For "${goal.name}" the long day is the specificity this phase is building, so a shortfall here matters more than one on a midweek ride.`,
        numbers: { actualHours: round(hours, 1), plannedHours: week.long_session_h, delta: round(delta, 1) },
      });
    }
  }

  if (role === 'strength') {
    const doneThisWeek = weekActs.filter((x) => /weight|strength/.test((x.type || '').toLowerCase())).length;
    if (week.strength_sessions) {
      flags.push({
        id: 'strength-vs-plan',
        severity: 'good',
        title: 'Strength session',
        text: `${doneThisWeek} of ${week.strength_sessions} planned strength sessions done this week (${week.phase}).`,
        numbers: { done: doneThisWeek, planned: week.strength_sessions },
      });
    }
  }

  if (week.target_tss) {
    flags.push({
      id: 'week-progress',
      severity: 'info',
      title: 'Week so far',
      text: `${tssSoFar} of ${week.target_tss} planned TSS for this ${week.phase}${week.is_recovery ? ' (recovery)' : ''} week, through this session.`,
      numbers: { tssSoFar, targetTss: week.target_tss },
    });
  }
}

const ROLE_LABEL = {
  long: 'Long session',
  'key-intensity': 'Key / intensity session',
  recovery: 'Recovery ride',
  endurance: 'Endurance ride',
  strength: 'Strength session',
};

function buildHeadline(a, role, flags) {
  const hours = round((a.moving_time || 0) / 3600, 1);
  const worst = flags.find((f) => f.severity === 'critical' || f.severity === 'warn');
  if (worst) return `${worst.title} — ${hours}h, ${round(a.tss, 0) || 0} TSS.`;
  const good = flags.find((f) => f.severity === 'good');
  if (good) return `${good.title} — ${hours}h, ${round(a.tss, 0) || 0} TSS.`;
  const label = ROLE_LABEL[role] || 'Ride';
  return a.intensity != null
    ? `${label}: ${hours}h at IF ${round(a.intensity, 2)}, ${round(a.tss, 0) || 0} TSS — nothing to flag.`
    : `${label}: ${hours}h, ${round(a.tss, 0) || 0} TSS — nothing to flag.`;
}

function renderMarkdown({ activity: a, role, week, goal, flags, headline }) {
  const L = [];
  L.push(`# ${a.date} — ${a.name || a.type || 'Activity'}`);
  L.push(`**${ROLE_LABEL[role] || 'Ride'}**${goal ? ` · ${goal.name}${week ? ` · ${week.phase} week` : ''}` : ''}`);
  L.push('');
  L.push(`## ${headline}`);
  L.push('');

  L.push(`| | |`);
  L.push(`| --- | --- |`);
  L.push(`| Duration | ${round((a.moving_time || 0) / 3600, 1)} h |`);
  if (a.tss != null) L.push(`| TSS | ${round(a.tss, 0)} |`);
  if (a.intensity != null) L.push(`| IF | ${round(a.intensity, 2)} |`);
  if (a.np != null) L.push(`| NP | ${round(a.np, 0)} W |`);
  if (a.vi != null) L.push(`| VI | ${round(a.vi, 2)} |`);
  if (a.ef != null) L.push(`| EF | ${round(a.ef, 3)} |`);
  if (a.avg_hr != null) L.push(`| Avg HR | ${round(a.avg_hr, 0)} |`);
  if (a.decoupling != null) L.push(`| Decoupling | ${round(a.decoupling, 1)}% |`);
  L.push('');

  const shown = flags.filter((f) => f.severity !== 'good' || flags.length === 1);
  if (shown.length) {
    L.push('## Flags');
    L.push('');
    for (const f of shown) {
      const tag = f.severity === 'critical' ? '🔴' : f.severity === 'warn' ? '🟠' : f.severity === 'good' ? '🟢' : '🔵';
      L.push(`- ${tag} **${f.title}** — ${f.text}`);
    }
    L.push('');
  }

  return L.join('\n');
}
