// Weekly brief generation.
//
// House rule, enforced by construction: every sentence that recommends something
// names the number that drove it. There is no "listen to your body" branch — if
// a rule has no number to cite, it does not fire.

import { db, getSetting, getSettingNum, getAthlete } from './db.js';
import { addDays, clamp, daysBetween, round, signed, today, weekStart } from './util.js';
import {
  currentFitness, rampRate, efTrend, viDrift, wbalRecoveryFlag, weekActuals,
  compareWeek, recentWeeks, fuellingSignals,
} from './metrics.js';
import { activePlan, weekForDate, activeGoal, adaptationInputs, regenerate, tssPerHour } from './planner.js';
import { painFlag, recentPain } from './backpain.js';

const SEV_ORDER = { critical: 0, warn: 1, info: 2, good: 3 };

export async function buildBrief({ goalId = null, asOf = today() } = {}) {
  const goal = goalId ? await db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId) : await activeGoal();
  const ws = weekStart(asOf);
  const lastWs = addDays(ws, -7);

  // Everything in this batch is independent of everything else in it — fired
  // together rather than awaited one at a time, since a networked DB's round
  // trip (not local disk I/O) is the dominant cost here once deployed.
  const [plan, fit, ramp, ef, vi, wbal, weeks8, fuel, painEvents, athlete, lastActual] = await Promise.all([
    goal ? activePlan(goal.id) : null,
    currentFitness(asOf),
    rampRate(asOf),
    efTrend(asOf),
    viDrift(addDays(asOf, -28), asOf),
    wbalRecoveryFlag(asOf),
    recentWeeks(asOf, 8),
    fuellingSignals(asOf),
    recentPain({ asOf, days: 28 }),
    getAthlete(),
    weekActuals(lastWs),
  ]);

  const [thisWeek, lastPlanWeek, pain] = await Promise.all([
    plan ? weekForDate(plan.id, ws) : null,
    plan ? weekForDate(plan.id, lastWs) : null,
    painFlag({ asOf }),
  ]);
  const comparison = lastPlanWeek ? compareWeek(lastPlanWeek, lastActual) : null;

  const flags = [];
  const actions = [];
  const governing = [];
  const tsb = fit.tsb;

  if (tsb != null) {
    flags.push({
      id: 'form',
      severity: tsb <= -25 ? 'critical' : tsb <= -15 ? 'warn' : tsb > 15 ? 'info' : 'good',
      title: 'Form (TSB)',
      text: `TSB ${signed(tsb)} · CTL ${fit.ctl} · ATL ${fit.atl}${fit.source === 'intervals' ? ' (from intervals.icu)' : ' (computed locally)'}. Form is yesterday's ${fit.ctlPrev} − ${fit.atlPrev}, the same convention intervals.icu shows, so it will not equal today's CTL − ATL.`,
      numbers: { tsb, ctl: fit.ctl, atl: fit.atl },
    });
  }

  // ------------------------------------------------------------------- Ramp
  const rampCap = thisWeek && (thisWeek.phase.startsWith('build') || thisWeek.phase === 'peak')
    ? await getSettingNum('max_ramp_build', 4)
    : await getSettingNum('max_ramp_base', 6);
  if (ramp != null && ramp > rampCap) {
    flags.push({
      id: 'ramp',
      severity: 'warn',
      title: 'Ramp rate above cap',
      text: `CTL rose ${signed(ramp)} in the last 7 days against a ${rampCap} CTL/wk cap for this phase. Hold next week at ${round((fit.ctl || 0) * 7, 0)} TSS (maintenance) rather than continuing to build.`,
      numbers: { ramp, rampCap },
      framework: 'Friel',
    });
    actions.push(`Hold next week at ~${round((fit.ctl || 0) * 7, 0)} TSS — ramp is ${signed(ramp)}/wk vs a ${rampCap} cap.`);
  }

  // --------------------------------------------------------------- EF trend
  let underRecovery = false;
  if (ef.reliable && ef.changePct != null) {
    const worsening = ef.changePct <= -3;
    flags.push({
      id: 'ef',
      severity: ef.changePct <= -5 ? 'warn' : ef.changePct <= -3 ? 'info' : 'good',
      title: 'Efficiency factor trend',
      text: `EF ${ef.recentMean} over the last ${ef.recentDays} days (n=${ef.recentN}) vs ${ef.baselineMean} in the preceding ${ef.baselineDays} days (n=${ef.baselineN}) — ${signed(ef.changePct)}%. Both windows IF-matched at ${ef.recentIfMean} vs ${ef.baselineIfMean}.`,
      numbers: { changePct: ef.changePct, recent: ef.recentMean, baseline: ef.baselineMean },
    });

    // The specific interpretation the athlete asked for: EF falling while
    // fatigue rises at matched intensity = under-recovery, not detraining.
    const atlRising = weeks8.length >= 4 && (weeks8[7]?.tss || 0) > (weeks8[4]?.tss || 0);
    underRecovery = ef.changePct <= -5 && (atlRising || (tsb ?? 0) < -15);
    if (underRecovery) {
      flags.push({
        id: 'under-recovery',
        severity: 'critical',
        title: 'Under-recovery signature',
        text: `EF is down ${signed(ef.changePct)}% at effectively the same intensity (IF ${ef.recentIfMean} vs ${ef.baselineIfMean}) while ATL sits at ${fit.atl} and TSB at ${signed(tsb)}. Same power costing more heart rate while fatigue climbs is under-recovery, not a fitness plateau — the fix is less load, not more.`,
        numbers: { efChangePct: ef.changePct, atl: fit.atl, tsb },
        framework: 'Friel',
      });
    } else if (worsening) {
      actions.push(`Watch EF: ${signed(ef.changePct)}% vs baseline. If it's still negative after this week's recovery days, drop the next block's volume by 20%.`);
    }
  } else if (ef.recentN + ef.baselineN > 0) {
    const [ifMin, ifMax, minMin] = await Promise.all([
      getSettingNum('ef_if_min', 0.55),
      getSettingNum('ef_if_max', 0.88),
      getSettingNum('ef_min_minutes', 45),
    ]);
    flags.push({
      id: 'ef-thin',
      severity: 'info',
      title: 'Efficiency factor',
      text: `Not enough IF-matched steady rides to trend EF: ${ef.recentN} in the last ${ef.recentDays} days, ${ef.baselineN} in the ${ef.baselineDays} before. Need ≥3 in each window at IF ${ifMin}–${ifMax} lasting ≥${minMin} min.`,
      numbers: { recentN: ef.recentN, baselineN: ef.baselineN },
    });
  }

  // ----------------------------------------------------------------- VI drift
  if (vi.offenders.length >= 2) {
    const list = vi.offenders.slice(-3).map((o) => `${o.date} (VI ${round(o.vi, 2)}, IF ${round(o.intensity, 2)})`).join(', ');
    flags.push({
      id: 'vi',
      severity: 'warn',
      title: 'Ragged pacing on steady rides',
      text: `${vi.offenders.length} of ${vi.n} rides at IF ≤ ${vi.ifMax} came in above VI ${vi.viCeiling}: ${list}. On a planned steady ride, VI above ${vi.viCeiling} means the aerobic stimulus is being replaced by repeated surges — that raises ATL without raising CTL usefully.`,
      numbers: { offenders: vi.offenders.length, n: vi.n, meanVi: vi.meanVi },
      framework: 'Friel',
    });
    actions.push(`On steady rides this week, hold VI under ${vi.viCeiling} — ${vi.offenders.length}/${vi.n} recent steady rides exceeded it.`);
  }

  // ------------------------------------------------------------------- W'bal
  if (wbal.enough && wbal.dropChangePct != null && wbal.dropChangePct > 15 && Math.abs(wbal.npChangePct ?? 0) < 5) {
    flags.push({
      id: 'wbal',
      severity: 'warn',
      title: "W' not recovering between sessions",
      text: `Across ${wbal.n} interval sessions in the last 28 days, mean W' consumed went from ${wbal.olderMeanDropKj} kJ to ${wbal.newerMeanDropKj} kJ (${signed(wbal.dropChangePct)}%) while mean NP barely moved (${wbal.olderMeanNp} → ${wbal.newerMeanNp} W, ${signed(wbal.npChangePct)}%). Same work, deeper into the tank each time — anaerobic capacity isn't restoring between sessions.`,
      numbers: wbal,
      framework: 'Friel',
    });
    actions.push(`Put 72 h between the next two interval sessions — W' consumption is up ${signed(wbal.dropChangePct)}% at unchanged NP (${wbal.newerMeanNp} W).`);
  }

  // --------------------------------------------------------------- Back pain
  if (pain) {
    flags.push({ id: 'back-pain', ...pain, framework: 'monitoring' });
    const highIfPlanned = (thisWeek?.z5_pct || 0) + (thisWeek?.z3_4_pct || 0) >= 15;
    if (pain.severity === 'warn' && highIfPlanned) {
      actions.push(
        `This week has ${round((thisWeek.z3_4_pct || 0) + (thisWeek.z5_pct || 0), 0)}% of time above Z2. Ride those intervals on the hoods, not in the drops — your drops pain rate at IF ≥ ${pain.numbers.ifThreshold} is ${pain.numbers.dropsPainRatePct}% vs ${pain.numbers.uprightPainRatePct ?? '—'}% upright.`
      );
    }
  }
  if (painEvents.length) {
    const worst = painEvents[0];
    flags.push({
      id: 'pain-recent',
      severity: painEvents.some((p) => p.back_pain === 'flare') ? 'warn' : 'info',
      title: 'Recent pain events',
      text: `${painEvents.length} logged pain event${painEvents.length > 1 ? 's' : ''} in the last 28 days. Most recent: ${worst.date}, ${worst.back_pain}, position ${worst.position || 'not logged'}, ride IF ${round(worst.intensity, 2) ?? '—'}, VI ${round(worst.vi, 2) ?? '—'}.`,
      numbers: { count: painEvents.length },
    });
  }

  // ------------------------------------------ Sims: fuelling / RED-S screening
  const redsFlag = redsScreen(fuel, fit, weeks8);
  if (redsFlag) {
    flags.push(redsFlag);
    if (redsFlag.action) actions.push(redsFlag.action);
  }
  const protFlag = proteinFlag(fuel, athlete, thisWeek?.target_tss);
  if (protFlag) {
    flags.push(protFlag);
    actions.push(protFlag.action);
  }

  // ------------------------------------------------- plan vs actual last week
  if (comparison) {
    const c = comparison;
    const sev = c.tssPct == null ? 'info' : c.tssPct < 75 || c.tssPct > 125 ? 'warn' : 'good';
    let text = `Last week: ${c.actualTss} TSS against ${c.plannedTss} planned (${c.tssPct}%), ${c.actualHours}h against ${c.plannedHours}h.`;
    if (c.distribution.actual.z1_2 != null) {
      text += ` Time split ${c.distribution.actual.z1_2}/${c.distribution.actual.z3_4}/${c.distribution.actual.z5} vs planned ${c.distribution.planned.z1_2}/${c.distribution.planned.z3_4}/${c.distribution.planned.z5}.`;
      if ((c.distribution.z3_4Delta ?? 0) + (c.distribution.z5Delta ?? 0) > 6) {
        text += ` That's ${round((c.distribution.z3_4Delta || 0) + (c.distribution.z5Delta || 0), 0)} percentage points more time above Z2 than prescribed — the usual cause of an unplanned ATL spike.`;
      }
    }
    if (c.longSession.plannedHours && c.longSession.deltaHours < -1) {
      text += ` Long session was ${c.longSession.actualHours}h against ${c.longSession.plannedHours}h planned (${signed(c.longSession.deltaHours, 1)}h) — for this goal the long day is the specificity, so protect it ahead of the midweek intervals.`;
    }
    flags.push({ id: 'compliance', severity: sev, title: 'Last week: planned vs actual', text, numbers: c });
  }

  // ---------------------------------------------- decide and APPLY the change
  // One adjustment, highest severity wins, written straight into the plan week
  // so the directive, the "do this" list and the week table cannot disagree.
  const adjustment = decideAdjustment({ thisWeek, fit, tsb, ef, ramp, rampCap, underRecovery });
  let week = thisWeek;
  if (adjustment && thisWeek && plan) {
    week = await applyAdjustment(thisWeek, adjustment);
    governing.push({
      decision: `in-week adjustment (${adjustment.id})`,
      framework: adjustment.framework,
      reason: `${thisWeek.target_tss} TSS → ${week.target_tss} TSS, Z5 ${thisWeek.z5_pct}% → ${week.z5_pct}%, Z3-4 ${thisWeek.z3_4_pct}% → ${week.z3_4_pct}%. ${adjustment.reason}`,
    });
  }

  const directive = buildDirective({ adjustment, week, thisWeek, fit, tsb, ramp, rampCap, comparison, goal, asOf, athlete });
  // The governing call is itself the first thing to do.
  if (directive.id !== 'no-plan') actions.unshift(directive.headline);

  // Pull the plan's own framework calls for this week into the brief.
  if (thisWeek?.governing_json) {
    try {
      governing.push(...JSON.parse(thisWeek.governing_json));
    } catch { /* ignore malformed */ }
  }

  flags.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  const metrics = {
    ctl: fit.ctl, atl: fit.atl, tsb, ramp, ctlPrev: fit.ctlPrev, atlPrev: fit.atlPrev,
    ef: { recent: ef.recentMean, baseline: ef.baselineMean, changePct: ef.changePct, reliable: ef.reliable },
    daysToEvent: goal ? daysBetween(asOf, goal.event_date) : null,
    lastWeek: comparison,
  };

  const body = renderMarkdown({ goal, thisWeek: week, ws, directive, flags, actions, governing, metrics, comparison, adjustment });

  return {
    goalId: goal?.id ?? null,
    planId: plan?.id ?? null,
    weekStart: ws,
    phase: week?.phase ?? null,
    headline: directive.headline,
    body,
    metrics,
    flags,
    actions,
    governing,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Pick at most one adjustment to this week, in severity order. Returns null
 * when the data supports leaving the plan alone — which is the common case and
 * must stay the common case, or the plan stops meaning anything.
 */
function decideAdjustment({ thisWeek, fit, tsb, ef, ramp, rampCap, underRecovery }) {
  if (!thisWeek || thisWeek.phase === 'race') return null;
  const ctlNow = fit.ctl;

  if (tsb != null && tsb <= -30) {
    return {
      id: 'tsb-critical',
      severity: 'critical',
      tsb,
      ctlNow,
      framework: 'Friel',
      tssFactor: 0.5,
      zones: { z5: 0, z3_4: 0 },
      reason: `TSB ${signed(tsb)} is below the -30 line where fatigue costs more than the adaptation it buys (fitness ${fit.ctlPrev}, fatigue ${fit.atlPrev}).`,
    };
  }
  if (underRecovery) {
    return {
      id: 'under-recovery',
      severity: 'critical',
      tsb,
      ctlNow,
      framework: 'Friel',
      tssFactor: 0.75,
      zones: { z5: 0, z3_4: Math.min(thisWeek.z3_4_pct, 5) },
      efChangePct: ef.changePct,
      reason: `EF ${signed(ef.changePct)}% at matched IF (${ef.recentIfMean} vs ${ef.baselineIfMean}) with ATL ${fit.atl}.`,
    };
  }
  // A load week (not yet at its scheduled recovery week) sitting around -20 is
  // the block working as intended, not a signal to intervene — the block's own
  // recovery week is what's supposed to bring TSB back up. Only fire this once
  // that safety net isn't in play (taper, or a recovery week that hasn't
  // resolved it).
  const isScheduledLoadWeek = thisWeek.phase !== 'taper' && !thisWeek.is_recovery;
  if (tsb != null && tsb <= -20 && !isScheduledLoadWeek) {
    return {
      id: 'tsb-low',
      severity: 'warn',
      framework: 'Friel',
      tsb,
      ctlNow,
      tssFactor: 1.0,
      zones: { z5: 0, z3_4: Math.min(thisWeek.z3_4_pct, 8) },
      reason: `TSB ${signed(tsb)} (fitness ${fit.ctlPrev}, fatigue ${fit.atlPrev}): volume is affordable, intensity on top of this fatigue is not.`,
    };
  }
  if (ramp != null && rampCap != null && ramp > rampCap && !thisWeek.is_recovery) {
    const maintenance = round((fit.ctl || 0) * 7, 0);
    if (maintenance > 0 && thisWeek.target_tss > maintenance) {
      return {
        id: 'ramp-over-cap',
        severity: 'warn',
        tsb,
        ctlNow,
        framework: 'Friel',
        absoluteTss: maintenance,
        reason: `CTL rose ${signed(ramp)} in 7 days against this phase's ${rampCap} CTL/wk cap; holding at maintenance load (CTL ${fit.ctl} × 7).`,
      };
    }
  }
  return null;
}

/**
 * Days of training at or below the current load before TSB reaches `target`.
 * ATL decays on a 7-day time constant; CTL on 42, so over a few days it is
 * effectively flat and the ATL term dominates.
 */
function daysToRecoverTsb(fit, target = -15) {
  const ctl = fit.ctlPrev ?? fit.ctl ?? 0;
  const atl = fit.atlPrev ?? fit.atl ?? 0;
  const ceiling = ctl - target; // ATL must fall to here
  if (!(atl > ceiling) || ceiling <= 0) return 1;
  return clamp(Math.ceil(7 * Math.log(atl / ceiling)), 1, 21);
}

/**
 * Write the adjustment into plan_weeks and return the updated row.
 * The key sessions and the long ride move with it — a week capped at Z2 that
 * still lists tempo intervals is worse than no advice at all.
 */
async function applyAdjustment(weekRow, adj) {
  const targetTss = adj.absoluteTss != null
    ? adj.absoluteTss
    : round(weekRow.target_tss * (adj.tssFactor ?? 1), 0);

  const z5 = adj.zones?.z5 ?? weekRow.z5_pct;
  const z34 = adj.zones?.z3_4 ?? weekRow.z3_4_pct;
  const z12 = round(100 - z5 - z34, 1);

  const dist = { z1_2: z12, z3_4: z34, z5 };
  const hours = round(targetTss / tssPerHour(dist), 1);

  // The long ride can never exceed what the reduced week can carry.
  const longH = round(Math.min(weekRow.long_session_h ?? hours * 0.45, hours * 0.45), 1);

  // Rewrite key sessions whenever intensity was pulled out of the week.
  let sessions;
  try {
    sessions = JSON.parse(weekRow.key_sessions_json || '[]');
  } catch {
    sessions = [];
  }
  const intensityRemoved = z5 < (weekRow.z5_pct ?? 0) || z34 < (weekRow.z3_4_pct ?? 0);
  if (intensityRemoved) {
    const strength = sessions.find((s) => s.name === 'Strength');
    const fuelling = sessions.find((s) => s.name.startsWith('Fuelling'));
    sessions = [
      { name: 'Long endurance', detail: `${longH}h steady, all of it below LT1 — the aerobic stimulus you can still absorb at TSB ${signed(adj.tsb)}.` },
      { name: 'Easy rides', detail: `Fill the remaining ${round(Math.max(0, hours - longH), 1)}h in 60–90 min pieces at conversational pace. Frequency preserved, intensity removed.` },
      z34 > 0
        ? { name: 'One tempo touch', detail: `At most ${round((z34 / 100) * hours * 60, 0)} min total at 76–85% FTP, and only if it feels easy that day.` }
        : { name: 'No intervals', detail: `Z3-4 and Z5 allocations are 0% this week; every planned interval session is postponed, not compressed into fewer days.` },
      strength || { name: 'Strength', detail: 'Keep the scheduled sessions — load held, volume halved.' },
      fuelling,
    ].filter(Boolean);
  }

  const note = [weekRow.notes, `Adjusted ${weekRow.target_tss} → ${targetTss} TSS on ${today()} (${adj.id}).`]
    .filter(Boolean)
    .join(' ');
  let governing;
  try {
    governing = JSON.parse(weekRow.governing_json || '[]');
  } catch {
    governing = [];
  }
  governing.push({
    decision: `in-week adjustment (${adj.id})`,
    framework: adj.framework,
    reason: adj.reason,
  });

  // Re-project CTL from the adjusted load so the week's end-state number is
  // the one this week will actually produce.
  let projected = adj.ctlNow ?? weekRow.projected_ctl ?? 0;
  for (let d = 0; d < 7; d++) projected += (targetTss / 7 - projected) / 42;

  await db
    .prepare(
      `UPDATE plan_weeks SET target_tss=?, target_hours=?, z1_2_pct=?, z3_4_pct=?, z5_pct=?,
       long_session_h=?, long_session_tss=?, key_sessions_json=?, projected_ctl=?, notes=?, governing_json=?
     WHERE id = ?`
    )
    .run(
      targetTss, hours, z12, z34, z5, longH, round(longH * 40, 0),
      JSON.stringify(sessions), round(projected, 1), note, JSON.stringify(governing), weekRow.id
    );

  return db.prepare('SELECT * FROM plan_weeks WHERE id = ?').get(weekRow.id);
}

/** Narrate the decision. Every branch names the number that drove it. */
function buildDirective({ adjustment, week, thisWeek, fit, tsb, ramp, rampCap, comparison, goal, asOf, athlete }) {
  if (!week) {
    return {
      id: 'no-plan',
      headline: 'No plan week covers this date.',
      text: goal
        ? `Goal "${goal.name}" runs ${goal.start_date} → ${goal.event_date}; ${asOf} sits outside that range. Regenerate the plan or set a new goal.`
        : 'No active goal. Create one to get a periodized plan and weekly briefs.',
      framework: '—',
      severity: 'info',
    };
  }

  const z2Watts = athlete.ftp ? `${round(athlete.ftp * 0.75, 0)} W` : 'the top of Z2';

  switch (adjustment?.id) {
    case 'tsb-critical':
      return {
        id: 'tsb-critical',
        severity: 'critical',
        framework: 'Friel',
        headline: `Form is ${signed(tsb)}. This week is cut to ${week.target_tss} TSS / ${week.target_hours}h, nothing above ${z2Watts}.`,
        text: `I'm pulling the plug on this week's intensity, and I want you to actually listen rather than push through it. TSB ${signed(tsb)} is fitness ${fit.ctlPrev} minus fatigue ${fit.atlPrev} — ${round(Math.abs(tsb), 0)} points of accumulated fatigue over your fitness, which is deep enough that the next hard session would cost more than it gives back. The planned ${thisWeek.target_tss} TSS has been halved and the ${thisWeek.z3_4_pct}% / ${thisWeek.z5_pct}% intensity allocation zeroed. Getting TSB back above -15 takes about ${daysToRecoverTsb(fit, -15)} day(s) at or below this load; do not schedule a quality session before then, no matter how good a day feels.`,
      };
    case 'under-recovery':
      return {
        id: 'under-recovery',
        severity: 'critical',
        framework: 'Friel',
        headline: `Cut to ${week.target_tss} TSS this week — EF is down ${signed(adjustment.efChangePct)}% at matched IF while ATL is ${fit.atl}.`,
        text: `This is the signature I watch for most closely: same power costing more heart rate while fatigue climbs is under-recovery, not a plateau, and pushing through it is exactly how a good block turns into a wasted one. This week is now ${week.target_tss} TSS / ${week.target_hours}h (was ${thisWeek.target_tss} / ${thisWeek.target_hours}h) with nothing above ${z2Watts}. Keep the ${week.long_session_h}h long ride — duration is not what is hurting you, intensity on top of fatigue is — and re-test EF on a steady 90 min ride next week so we know whether this week actually worked.`,
      };
    case 'tsb-low':
      return {
        id: 'tsb-low',
        severity: 'warn',
        framework: 'Friel',
        headline: `Cap intensity at Z2 this week — Form is at ${signed(tsb)}. Volume stays at ${week.target_tss} TSS.`,
        text: `You don't need to back off the miles, just the sharp stuff. TSB ${signed(tsb)} (fitness ${fit.ctlPrev} minus fatigue ${fit.atlPrev}) means aerobic volume is still productive — it's intensity on top of it that isn't. The week's Z5 allocation has gone from ${thisWeek.z5_pct}% to ${week.z5_pct}% of time and Z3-4 from ${thisWeek.z3_4_pct}% to ${week.z3_4_pct}%, with the ${week.target_hours}h redistributed below ${z2Watts}. Reinstate one quality session only if TSB is above -15 by Thursday — otherwise this stays an easy week.`,
      };
    case 'ramp-over-cap':
      return {
        id: 'ramp-over-cap',
        severity: 'warn',
        framework: 'Friel',
        headline: `Hold at ${week.target_tss} TSS this week — CTL ramped ${signed(ramp)} against a ${rampCap}/wk cap.`,
        text: `You've been building faster than the plan for this phase actually wants — CTL went from ${round((fit.ctl || 0) - (ramp || 0), 1)} to ${fit.ctl} in seven days, and fast fitness gains are usually fast fatigue gains too. The plan asked for ${thisWeek.target_tss} TSS; that is now ${week.target_tss} (maintenance at CTL ${fit.ctl} × 7). Consolidate this week rather than adding more — the ramp resumes next week from a CTL that has actually been absorbed, not just accumulated.`,
      };
    default:
      break;
  }

  if (tsb != null && tsb >= 10 && !['taper', 'race'].includes(week.phase) && !week.is_recovery) {
    return {
      id: 'tsb-high',
      severity: 'info',
      framework: 'Friel',
      headline: `Form is ${signed(tsb)} in a ${week.phase} week — take the full ${week.target_tss} TSS including the ${week.long_session_h}h long session.`,
      text: `You've got room here, and this is a good week to use it. TSB ${signed(tsb)} at CTL ${fit.ctl} means you are under-loaded for this phase rather than freshened for a reason — that's not a state to protect, it's fitness sitting on the table. Ramp is ${ramp == null ? 'not yet measurable' : signed(ramp) + ' CTL/wk'} against a ${rampCap} cap, so there is headroom. Last week landed at ${comparison?.tssPct ?? '—'}% of target — the gap to close is volume, not intensity.`,
    };
  }

  return {
    id: 'on-plan',
    severity: 'good',
    framework: 'Friel',
    headline: `Execute the plan: ${week.target_tss} TSS / ${week.target_hours}h, ${week.z1_2_pct}/${week.z3_4_pct}/${week.z5_pct} time split, ${week.long_session_h}h long session, ${week.strength_sessions} strength.`,
    text: `Nothing to adjust this week — just execute. TSB ${signed(tsb)} and ramp ${ramp == null ? 'n/a' : signed(ramp) + ' CTL/wk'} (cap ${rampCap}) are both inside limits for a ${week.phase} week${week.is_recovery ? ' (recovery)' : ''}, and last week landed at ${comparison?.tssPct ?? '—'}% of target. When the numbers agree with the plan like this, the best thing I can tell you is to trust it and get the work done.`,
  };
}

export function redsScreen(fuel, fit, weeks8) {
  // Only fires on numbers. Needs a rising load AND at least one physiological
  // marker moving the wrong way; otherwise it stays quiet.
  const loadEarly = weeks8.slice(0, 4).reduce((s, w) => s + (w.tss || 0), 0) / 4;
  const loadLate = weeks8.slice(4).reduce((s, w) => s + (w.tss || 0), 0) / 4;
  if (!loadEarly || !loadLate) return null;
  const loadChange = ((loadLate - loadEarly) / loadEarly) * 100;
  if (loadChange < 10) return null;

  const markers = [];
  if (fuel.weightChangePct != null && fuel.weightChangePct <= -1.5) {
    markers.push(`body mass ${signed(fuel.weightChangePct, 1)}% over ${fuel.days} days (now ${fuel.weightLate} kg)`);
  }
  if (fuel.rhrChange != null && fuel.rhrChange >= 3) {
    markers.push(`resting HR ${signed(fuel.rhrChange)} bpm (now ${fuel.rhrLate})`);
  }
  if (fuel.hrvChangePct != null && fuel.hrvChangePct <= -8) {
    markers.push(`HRV ${signed(fuel.hrvChangePct)}%`);
  }
  if (fuel.hasIntakeData && fuel.intakeMean != null && loadChange > 15) {
    markers.push(`logged intake flat at ${fuel.intakeMean} kcal/day while load rose ${round(loadChange, 0)}%`);
  }
  if (!markers.length) return null;

  return {
    id: 'reds',
    severity: markers.length >= 2 ? 'critical' : 'warn',
    title: 'Low energy availability risk',
    framework: 'Sims',
    text: `4-week load is up ${round(loadChange, 0)}% (${round(loadEarly, 0)} → ${round(loadLate, 0)} TSS/wk) alongside ${markers.join(', ')}. That combination is the early signature of low energy availability, and it is a nutrition problem before it is a training problem.`,
    numbers: { loadChangePct: round(loadChange, 0), ...fuel },
    action: `Raise daily intake to match the ${round(loadLate - loadEarly, 0)} TSS/wk increase before adding any more load — start with carbohydrate during sessions over 90 min and 30–40 g protein within 30 min after every hard session.`,
  };
}

/**
 * Logged protein (daily_logs.protein_g) against 2.0 g/kg bodyweight, once
 * there are ≥5 logged days. `weekTargetTss` is optional context (the current
 * plan week's target) purely for the wording — the threshold itself doesn't
 * depend on it. Shared between the weekly brief and GET /api/metrics/fuelling
 * so both read the same number the same way.
 */
export function proteinFlag(fuel, athlete, weekTargetTss = null) {
  if (!athlete?.weight_kg) return null;
  const proteinTarget = round(athlete.weight_kg * 2.0, 0);
  if (!(fuel.proteinN >= 5) || fuel.proteinMean == null || !(fuel.proteinMean < proteinTarget * 0.85)) return null;
  const weekClause = weekTargetTss != null
    ? ` At ${weekTargetTss} TSS/wk that shortfall shows up as poor session-to-session recovery before it shows up anywhere else.`
    : ' A shortfall this size usually shows up as poor session-to-session recovery before it shows up anywhere else.';
  return {
    id: 'protein',
    severity: 'warn',
    title: 'Protein below target',
    text: `Logged protein averages ${fuel.proteinMean} g/day over ${fuel.proteinN} logged days against a ${proteinTarget} g target (2.0 g/kg at ${athlete.weight_kg} kg).${weekClause}`,
    numbers: { mean: fuel.proteinMean, target: proteinTarget },
    framework: 'Sims',
    action: `Add ~${round(proteinTarget - fuel.proteinMean, 0)} g protein/day, weighted to within 30 min post-session (target ${proteinTarget} g/day at ${athlete.weight_kg} kg).`,
  };
}

function renderMarkdown({ goal, thisWeek, ws, directive, flags, actions, governing, metrics, comparison, adjustment }) {
  const L = [];
  const phaseLabel = thisWeek
    ? `${thisWeek.phase}${thisWeek.is_recovery ? ' · recovery week' : ''} · week ${thisWeek.week_in_block} of block ${thisWeek.block_index}`
    : 'no plan week';
  L.push(`# Week of ${ws}`);
  if (goal) {
    L.push(
      `**${goal.name}** — ${goal.event_date} (${metrics.daysToEvent} days out) · ${phaseLabel}`
    );
  }
  L.push('');
  L.push(`## ${directive.headline}`);
  L.push('');
  L.push(directive.text);
  L.push('');
  L.push(`*Governing framework for this call: ${directive.framework}.*`);
  L.push('');

  if (thisWeek) {
    L.push('## This week');
    L.push('');
    if (adjustment) {
      L.push(`*These targets are the adjusted ones — the plan week was rewritten in place (${adjustment.id}), so this table, the call above and the actions below are the same numbers.*`);
      L.push('');
    }
    L.push(`| Target | Value |`);
    L.push(`| --- | --- |`);
    L.push(`| TSS | ${thisWeek.target_tss} |`);
    L.push(`| Hours | ${thisWeek.target_hours} |`);
    L.push(`| Time split Z1-2 / Z3-4 / Z5+ | ${thisWeek.z1_2_pct} / ${thisWeek.z3_4_pct} / ${thisWeek.z5_pct} % |`);
    L.push(`| Long session | ${thisWeek.long_session_h} h |`);
    L.push(`| Strength | ${thisWeek.strength_sessions} × |`);
    L.push(`| Projected CTL at week end | ${thisWeek.projected_ctl} |`);
    L.push('');
    if (thisWeek.focus) L.push(`${thisWeek.focus}`);
    L.push('');
    const sessions = safeJson(thisWeek.key_sessions_json) || [];
    if (sessions.length) {
      L.push('**Key sessions**');
      L.push('');
      for (const s of sessions) L.push(`- **${s.name}** — ${s.detail}`);
      L.push('');
    }
  }

  L.push('## Where you are');
  L.push('');
  L.push(narrateState(metrics));
  L.push('');
  L.push(
    `Fitness (CTL) ${metrics.ctl} · Fatigue (ATL) ${metrics.atl} · Form (TSB) ${signed(metrics.tsb)} · ramp ${metrics.ramp == null ? 'n/a' : signed(metrics.ramp) + '/wk'}` +
      (metrics.ef.reliable ? ` · EF ${metrics.ef.recent} (${signed(metrics.ef.changePct)}% vs ${metrics.ef.baseline})` : ' · EF trend not yet reliable')
  );
  L.push('');
  L.push(`*Form is yesterday's CTL ${metrics.ctlPrev} minus yesterday's ATL ${metrics.atlPrev} — the intervals.icu convention. It is deliberately not today's CTL − ATL.*`);
  L.push('');

  if (actions.length) {
    L.push('## Do this');
    L.push('');
    for (const a of actions) L.push(`- ${a}`);
    L.push('');
  }

  const shown = flags.filter((f) => f.severity !== 'good');
  if (shown.length) {
    L.push('## Flags');
    L.push('');
    for (const f of shown) {
      const tag = f.severity === 'critical' ? '🔴' : f.severity === 'warn' ? '🟠' : '🔵';
      L.push(`- ${tag} **${f.title}** — ${f.text}${f.framework && f.framework !== 'monitoring' ? ` *(${f.framework})*` : ''}`);
    }
    L.push('');
  }

  if (comparison) {
    L.push('## Last week: planned vs actual');
    L.push('');
    L.push('| | Planned | Actual | Δ |');
    L.push('| --- | --- | --- | --- |');
    L.push(`| TSS | ${comparison.plannedTss} | ${comparison.actualTss} | ${signed(comparison.tssDelta)} |`);
    L.push(`| Hours | ${comparison.plannedHours} | ${comparison.actualHours} | ${signed((comparison.actualHours || 0) - (comparison.plannedHours || 0), 1)} |`);
    L.push(`| Z1-2 % | ${comparison.distribution.planned.z1_2} | ${comparison.distribution.actual.z1_2 ?? '—'} | ${comparison.distribution.z1_2Delta == null ? '—' : signed(comparison.distribution.z1_2Delta, 1)} |`);
    L.push(`| Z3-4 % | ${comparison.distribution.planned.z3_4} | ${comparison.distribution.actual.z3_4 ?? '—'} | ${comparison.distribution.z3_4Delta == null ? '—' : signed(comparison.distribution.z3_4Delta, 1)} |`);
    L.push(`| Z5+ % | ${comparison.distribution.planned.z5} | ${comparison.distribution.actual.z5 ?? '—'} | ${comparison.distribution.z5Delta == null ? '—' : signed(comparison.distribution.z5Delta, 1)} |`);
    L.push(`| Long session (h) | ${comparison.longSession.plannedHours} | ${comparison.longSession.actualHours} | ${signed(comparison.longSession.deltaHours, 1)} |`);
    L.push('');
  }

  if (governing.length) {
    L.push('## Framework calls');
    L.push('');
    for (const g of governing) {
      L.push(`- **${g.decision} → ${g.framework}.** ${g.reason}${g.alternative ? ` *Not taken:* ${g.alternative}` : ''}`);
    }
    L.push('');
  }

  return L.join('\n');
}

/**
 * One sentence, in plain coach language, glossing the same TSB/EF numbers
 * printed right below it — never a claim the numbers don't support, just the
 * reading a coach would give out loud before pointing at the table.
 */
function narrateState(metrics) {
  const { tsb, ef } = metrics;
  let s;
  if (tsb == null) {
    s = 'Not enough recent training data yet to read Form reliably.';
  } else if (tsb <= -20) {
    s = "Fatigue is running well ahead of fitness right now — that gap is the main thing driving this week's call, more than anything about the plan itself.";
  } else if (tsb <= -10) {
    s = "You're carrying a normal, productive amount of fatigue for a loading block — tired but not buried.";
  } else if (tsb < 5) {
    s = 'Fitness and fatigue are close to balanced right now — a stable, sustainable place to be building from.';
  } else if (tsb < 15) {
    s = "You're on the fresh side of neutral — nothing wrong with that, and there's room to load a bit more if the phase calls for it.";
  } else {
    s = "You're notably fresh relative to recent load — fine right before a race, but if there's no race this week that freshness is fitness sitting unused.";
  }
  if (ef.reliable && ef.changePct != null) {
    if (ef.changePct <= -5) {
      s += ' Efficiency has been sliding at matched effort too, which is usually the earlier warning sign — worth taking seriously even if TSB alone looks fine.';
    } else if (ef.changePct >= 5) {
      s += ' Efficiency is trending up at matched effort — a good sign the aerobic base is deepening underneath all this.';
    }
  }
  return s;
}

function safeJson(s) {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export async function saveBrief(brief) {
  await db
    .prepare(
      `INSERT INTO briefs (plan_id, goal_id, week_start, generated_at, phase, headline, body_md,
       metrics_json, flags_json, actions_json, governing_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(week_start) DO UPDATE SET
       plan_id=excluded.plan_id, goal_id=excluded.goal_id, generated_at=excluded.generated_at,
       phase=excluded.phase, headline=excluded.headline, body_md=excluded.body_md,
       metrics_json=excluded.metrics_json, flags_json=excluded.flags_json,
       actions_json=excluded.actions_json, governing_json=excluded.governing_json`
    )
    .run(
      brief.planId, brief.goalId, brief.weekStart, brief.generatedAt, brief.phase, brief.headline, brief.body,
      JSON.stringify(brief.metrics), JSON.stringify(brief.flags), JSON.stringify(brief.actions),
      JSON.stringify(brief.governing)
    );
  return getBrief(brief.weekStart);
}

export async function getBrief(weekStartDate) {
  return (await db.prepare('SELECT * FROM briefs WHERE week_start = ?').get(weekStartDate)) || null;
}

export async function listBriefs(limit = 52) {
  return db.prepare('SELECT * FROM briefs ORDER BY week_start DESC LIMIT ?').all(limit);
}

/**
 * The weekly cycle: regenerate the plan from actuals, then write the brief.
 * Called by the scheduler on Mondays and on demand from the UI.
 */
export async function runWeekly({ goalId = null, asOf = today(), replan = true } = {}) {
  const goal = goalId ? await db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId) : await activeGoal();
  let replanned = null;
  if (goal && replan) {
    const adapt = await adaptationInputs(asOf);
    // Regenerate whenever the plan's assumptions have moved: CTL drift,
    // compliance drift, or an under-recovery signature. Weeks before the
    // current one are carried over, so the original prescription is preserved.
    replanned = await regenerate(goal.id, buildReplanReason(adapt));
  }
  const brief = await buildBrief({ goalId: goal?.id ?? null, asOf });
  const saved = await saveBrief(brief);
  return { brief: saved, replanned: replanned ? { planId: replanned.planId, version: replanned.version } : null };
}

function buildReplanReason(adapt) {
  const bits = [`CTL ${adapt.ctl}`, `TSB ${signed(adapt.tsb)}`];
  if (adapt.compliancePct != null) bits.push(`compliance ${adapt.compliancePct}%`);
  if (adapt.efChangePct != null) bits.push(`EF ${signed(adapt.efChangePct)}%`);
  if (adapt.underRecovery) bits.push('under-recovery');
  return `weekly-adaptive: ${bits.join(', ')}`;
}
