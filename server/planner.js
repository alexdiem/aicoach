// Plan generation.
//
// GOVERNING FRAMEWORKS
// -------------------
// Friel (Training Bible) governs *structure*: phase sequence, CTL/ATL/TSB-driven
// load progression, 3:1 loading blocks, specificity near the event, taper length
// scaled to event duration.
//
// Sims (ROAR) governs the *shape* of intensity within that structure: this is a
// polarized model, not Friel's pyramidal one — see distributionFor below. Time
// above easy stays almost entirely at the genuinely-hard end (short maximal
// efforts, threshold, VO2) rather than spread into moderate-intensity "tempo" or
// "sweet spot" work. Sims is explicit that women respond poorly to chronic
// moderate-intensity volume — it raises cortisol without the adaptive stimulus
// real hard efforts provide — so that gray zone (roughly 76–93% FTP) is deliberately
// almost empty at every phase, not just tapered down in base like a pyramidal
// model would. The one exception is build1's threshold work, which sits at/above
// threshold (95–102% FTP) and counts as the hard pole, not the gray zone.
//
// Strength dosing follows the athlete's own logged seasonal pattern (see
// seasonalStrengthSessions below) rather than a framework-derived rule —
// calibrated directly against what she has actually sustained, not eyeballed.
// Each override is recorded in plan_weeks.governing_json with the reason
// given — nothing is silently averaged.

import { db, dbTransaction, getSetting, getSettingNum, getAthlete } from './db.js';
import { addDays, clamp, daysBetween, isoDate, mean, round, today, weekStart } from './util.js';
import { currentFitness, recentWeeks, efTrend } from './metrics.js';

// TSS accumulated per hour at the centre of each intensity band.
// Z1-2 ≈ IF 0.62, Z3-4 ≈ IF 0.87, Z5+ ≈ IF 1.0  (TSS/h = IF² × 100)
const TSS_PER_HOUR = { low: 38, mid: 76, high: 100 };

// --- event demand -----------------------------------------------------------

/** Moving-time IF an athlete can hold for a given duration (Friel/Coggan style decay). */
export function durationIF(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return 0.85;
  const h = Math.max(0.25, hours);
  // Anchored at 1h = 0.95 and decaying logarithmically; floors out for multi-day.
  return clamp(0.95 - 0.105 * Math.log(h), 0.45, 1.0);
}

export function estimateDuration(goal) {
  if (goal.est_duration_h) return { hours: goal.est_duration_h, source: 'user' };
  const dist = goal.distance_km || 0;
  const climb = goal.elevation_m || 0;
  const selfSupported = goal.support === 'self-supported';
  const sport = (goal.sport || 'Ride').toLowerCase();

  if (!dist && !climb) {
    // A metric goal (e.g. "FTP 260") has no distance; treat as a ~1h test effort.
    return { hours: goal.kind === 'metric' ? 1 : 3, source: 'default' };
  }

  const climbPerKm = dist ? climb / dist : 0;

  if (sport.includes('ski') || sport.includes('hike') || sport.includes('skitour') || sport.includes('backcountry')) {
    // Vertical dominates: ~450 m/h ascent plus flat travel at 4.5 km/h.
    const hours = climb / 450 + dist / 4.5;
    return { hours: round(hours, 1), source: 'model:vertical', climbPerKm: round(climbPerKm, 1) };
  }

  if (sport.includes('run')) {
    const base = 10; // km/h on flat
    const speed = Math.max(base * (1 - 0.015 * climbPerKm), base * 0.45);
    const moving = dist / speed;
    return {
      hours: round(selfSupported ? moving * 1.15 : moving, 1),
      source: 'model:run',
      speedKmh: round(speed, 1),
      climbPerKm: round(climbPerKm, 1),
    };
  }

  const base = selfSupported ? 22 : 26; // km/h flat
  const speed = Math.max(base * (1 - 0.01 * climbPerKm), base * 0.5);
  const moving = dist / speed;
  return {
    hours: round(moving, 1),
    source: 'model:ride',
    speedKmh: round(speed, 1),
    climbPerKm: round(climbPerKm, 1),
    // Self-supported events include sleep/resupply; riders care about elapsed too.
    elapsedHours: round(selfSupported ? moving * 1.4 : moving * 1.08, 1),
  };
}

export function durationClass(hours) {
  if (hours <= 1.5) return 'sprint';
  if (hours <= 6) return 'middle';
  if (hours <= 24) return 'long';
  return 'ultra';
}

/**
 * Intensity distribution (% of weekly *time*) per phase, shaped by how long the
 * event is. Polarized (Sims/Seiler), not pyramidal: Z3-4 — the tempo/sweet-spot
 * gray zone — is held near-minimal at every phase rather than ramping up through
 * base like a traditional model. Time freed from it goes to genuinely easy Z1-2
 * or genuinely hard Z5+, scaled toward Z5 as the event gets shorter/harder
 * (an ultra's specificity is duration at low intensity; a 1h target's is time
 * above threshold) and as the block approaches the event.
 */
export function distributionFor(phase, cls) {
  const table = {
    sprint: {
      prep: [85, 5, 10], base1: [82, 4, 14], base2: [80, 3, 17], base3: [78, 3, 19],
      build1: [76, 2, 22], build2: [74, 2, 24], peak: [73, 2, 25], taper: [78, 3, 19], race: [82, 4, 14],
    },
    middle: {
      prep: [88, 4, 8], base1: [85, 3, 12], base2: [83, 3, 14], base3: [81, 3, 16],
      build1: [79, 2, 19], build2: [77, 2, 21], peak: [76, 2, 22], taper: [80, 3, 17], race: [85, 3, 12],
    },
    long: {
      prep: [90, 4, 6], base1: [87, 3, 10], base2: [85, 3, 12], base3: [83, 3, 14],
      build1: [81, 2, 17], build2: [80, 2, 18], peak: [79, 2, 19], taper: [82, 3, 15], race: [88, 3, 9],
    },
    ultra: {
      prep: [92, 3, 5], base1: [89, 3, 8], base2: [88, 3, 9], base3: [87, 3, 10],
      build1: [85, 2, 13], build2: [84, 2, 14], peak: [84, 2, 14], taper: [86, 3, 11], race: [90, 3, 7],
    },
  };
  const row = (table[cls] || table.middle)[phase] || (table[cls] || table.middle).base2;
  return { z1_2: row[0], z3_4: row[1], z5: row[2] };
}

export function tssPerHour(dist) {
  return (
    (dist.z1_2 / 100) * TSS_PER_HOUR.low +
    (dist.z3_4 / 100) * TSS_PER_HOUR.mid +
    (dist.z5 / 100) * TSS_PER_HOUR.high
  );
}

/**
 * Peak weekly hours the event justifies. Smooth log fit through the usual
 * coaching anchors: 1h event → ~8 h/wk, 6h → ~13.5, 24h → ~17.7, 60h → ~20.5.
 */
export function peakWeeklyHours(eventHours, maxHours) {
  const h = 8 + 3.05 * Math.log(Math.max(1, eventHours));
  const capped = clamp(h, 6, 25);
  return maxHours ? Math.min(capped, maxHours) : capped;
}

export function peakLongSessionHours(eventHours, cls) {
  if (cls === 'ultra') return clamp(eventHours * 0.25, 5, 12);
  if (cls === 'long') return clamp(eventHours * 0.5, 4, 10);
  return clamp(eventHours * 0.75, 1.5, 8);
}

export function taperWeeksFor(eventHours) {
  if (eventHours <= 2) return 1;
  if (eventHours <= 6) return 2;
  if (eventHours <= 15) return 2;
  return 3;
}

// --- phase allocation -------------------------------------------------------

export function allocatePhases(totalWeeks, eventHours, startCtl, targetCtl) {
  const W = Math.max(1, totalWeeks);
  let taper = Math.min(taperWeeksFor(eventHours), Math.max(1, Math.floor(W / 4)));
  let peak = W >= 12 ? 2 : W >= 8 ? 1 : 0;
  let remaining = W - taper - peak - 1; // -1 for race week
  if (remaining < 0) {
    peak = 0;
    remaining = W - taper - 1;
  }
  if (remaining < 0) {
    taper = Math.max(0, W - 1);
    remaining = W - taper - 1;
  }

  // Friel: base is the largest period; build ~40% of what's left after peak/taper.
  let build = remaining >= 6 ? Math.max(2, Math.round(remaining * 0.4)) : Math.max(0, Math.floor(remaining / 3));
  let base = remaining - build;

  // A long runway with a big fitness gap starts with a general-prep block.
  let prep = 0;
  if (W >= 24 && targetCtl - startCtl > 30) {
    prep = Math.min(4, Math.floor(base * 0.2));
    base -= prep;
  }

  const seq = [];
  for (let i = 0; i < prep; i++) seq.push('prep');
  const b1 = Math.ceil(base / 3);
  const b2 = Math.ceil((base - b1) / 2);
  const b3 = base - b1 - b2;
  for (let i = 0; i < b1; i++) seq.push('base1');
  for (let i = 0; i < b2; i++) seq.push('base2');
  for (let i = 0; i < b3; i++) seq.push('base3');
  const bu1 = Math.ceil(build / 2);
  for (let i = 0; i < bu1; i++) seq.push('build1');
  for (let i = 0; i < build - bu1; i++) seq.push('build2');
  for (let i = 0; i < peak; i++) seq.push('peak');
  for (let i = 0; i < taper; i++) seq.push('taper');
  seq.push('race');
  return seq.slice(0, W);
}

// --- strength dosing ---------------------------------------------------------

/**
 * Strength frequency by calendar month, not training phase — this is the
 * athlete's own logged, sustained pattern (light in summer, heaviest in
 * winter), not a framework-derived rule.
 */
export function seasonalStrengthSessions(dateStr) {
  const month = Number(dateStr.slice(5, 7));
  if (month >= 6 && month <= 8) return 1; // summer: Jun-Aug
  if (month === 12 || month <= 2) return 3; // winter: Dec-Feb
  return 2; // spring/autumn: Mar-May, Sep-Nov
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// --- key sessions -----------------------------------------------------------

function keySessions(phase, cls, goal, ctx) {
  const climbHeavy = goal.elevation_m && goal.distance_km && goal.elevation_m / goal.distance_km > 12;
  const longH = ctx.longHours;
  const s = [];
  const climbNote = climbHeavy ? ' on sustained climbs (course is ' + round(goal.elevation_m / goal.distance_km, 0) + ' m/km)' : '';
  const strength = ctx.strength ?? 2;
  const strengthX = `${strength}×/wk`;
  // Rotates every week within a multi-week base block so a long base period
  // isn't the same three sessions repeated verbatim for a month straight.
  const variant = (ctx.weekIndex ?? 0) % 3;

  switch (phase) {
    case 'prep':
      s.push({ name: 'Aerobic ride', detail: `2× ${round(longH * 0.5, 1)}h steady Z2, cadence 85–95` });
      s.push({ name: 'Strength', detail: `Anatomical adaptation: ${strengthX} full-body, 3×12 at moderate load` });
      break;
    case 'base1':
    case 'base2': {
      const endurance = [
        `${longH}h Z2, negative-split the second half`,
        `${longH}h Z2, steady effort throughout — focus on cadence (85–95) and fuelling rhythm`,
        `${longH}h Z2 with 3× 5 min at 95+ rpm worked in through the ride`,
      ][variant];
      const sit = [
        `6× 20 s all-out (SIT)${climbNote}, full 4 min recovery between — first half of the ride, while neuromuscular freshness is highest`,
        `8× 20 s all-out (SIT)${climbNote}, full 4 min recovery between — first half of the ride`,
        `6× 30 s all-out (SIT)${climbNote}, full 4–5 min recovery between — first half of the ride`,
      ][variant];
      s.push({ name: 'Long endurance', detail: endurance });
      s.push({ name: 'SIT', detail: sit });
      s.push({ name: 'Strength', detail: `Max-strength: ${strengthX} lower-body, 4×4–6 at 80–85% 1RM + plyometrics` });
      break;
    }
    case 'base3': {
      const endurance = [
        `${longH}h Z2, negative-split the second half`,
        `${longH}h Z2, steady effort throughout — focus on cadence (85–95) and fuelling rhythm`,
        `${longH}h Z2 with 3× 5 min at 95+ rpm worked in through the ride`,
      ][variant];
      const sit = [
        `8× 30 s all-out (SIT)${climbNote}, full 4 min recovery between — first half of the ride`,
        `6× 40 s all-out (SIT)${climbNote}, full 4–5 min recovery between — first half of the ride`,
        `10× 30 s all-out (SIT)${climbNote}, full 4 min recovery between — first half of the ride`,
      ][variant];
      s.push({ name: 'Long endurance', detail: endurance });
      s.push({ name: 'SIT', detail: sit });
      s.push({ name: 'Strength', detail: `Max-strength: ${strengthX} lower-body, 4×4–6 at 85% 1RM + plyometrics` });
      break;
    }
    case 'build1':
      s.push({ name: 'Threshold', detail: `3× 15 min at 95–102% FTP${climbNote}, 6 min recovery` });
      s.push({ name: 'Long specific', detail: cls === 'ultra' || cls === 'long'
        ? `${longH}h at target event pace, fuelled at the rate you'll use on the day`
        : `${longH}h with 2× 20 min at goal-event intensity` });
      s.push({ name: 'Strength', detail: `Max-strength maintained at ${strengthX}, 3×5 heavy` });
      break;
    case 'build2':
      s.push({ name: 'VO2', detail: '5× 4 min at 108–118% FTP, equal recovery' });
      s.push({ name: 'Race simulation', detail: cls === 'ultra'
        ? `Back-to-back: ${longH}h then ${round(longH * 0.7, 1)}h next day, full event kit and fuelling`
        : `${longH}h with race-pace blocks and full event fuelling` });
      s.push({ name: 'Strength', detail: `Power emphasis: ${strengthX}, 3×3 heavy + explosive jumps` });
      break;
    case 'peak':
      s.push({ name: 'Sharpening', detail: '2× session of 8× 2 min at 110% FTP or 6× 3 min at goal intensity' });
      s.push({ name: 'Specificity ride', detail: `${longH}h dress-rehearsal: event kit, event fuelling, event position` });
      s.push({ name: 'Strength', detail: `${strengthX} kept, load held, volume cut to 2×4 — maintains bone and power` });
      break;
    case 'taper':
      s.push({ name: 'Openers', detail: 'Every 2–3 days: 4× 90 s at goal intensity inside an otherwise easy ride' });
      s.push({ name: 'Volume', detail: 'Frequency unchanged, duration cut — do not add rest days' });
      s.push({ name: 'Strength', detail: `${strengthX}, load kept, volume halved` });
      break;
    case 'race':
      s.push({ name: 'Event', detail: goal.name });
      s.push({ name: 'Pre-event', detail: '2 days out: 45 min easy with 3× 60 s at goal intensity' });
      break;
  }
  return s;
}

// --- the generator ----------------------------------------------------------

/**
 * Build (or rebuild) the plan for a goal.
 * `from` defaults to the current week: earlier weeks are carried over from the
 * previous active version so the record of what was originally prescribed
 * survives every regeneration.
 */
export async function generatePlan(goalId, { reason = 'manual', from = null, asOf = today() } = {}) {
  const goal = await db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId);
  if (!goal) throw new Error(`No goal with id ${goalId}`);

  const athlete = await getAthlete();
  const fitness = await currentFitness(asOf);
  const startCtl = fitness.ctl || 0;
  const planStartWeek = weekStart(goal.start_date);
  const eventWeek = weekStart(goal.event_date);
  const regenFrom = weekStart(from || asOf);
  const firstWeek = regenFrom > planStartWeek ? regenFrom : planStartWeek;

  const demand = estimateDuration(goal);
  const cls = durationClass(demand.hours);
  const eventIF = durationIF(demand.hours);
  const eventTss = round(demand.hours * eventIF * eventIF * 100, 0);

  const maxHours = await getSettingNum('max_weekly_hours', null);
  const pkHours = peakWeeklyHours(demand.hours, maxHours);
  const peakDist = distributionFor('peak', cls);
  const peakWeeklyTss = pkHours * tssPerHour(peakDist);
  const targetCtl = round(peakWeeklyTss / 7, 0);

  const totalWeeks = Math.max(1, Math.floor(daysBetween(planStartWeek, eventWeek) / 7) + 1);
  const seq = allocatePhases(totalWeeks, demand.hours, startCtl, targetCtl);

  // Adaptive inputs: how the last few weeks actually went.
  const adapt = await adaptationInputs(asOf);
  const loadPattern = (await getSetting('load_pattern', '3:1')) === '2:1' ? 2 : 3;
  let maxRampBase = await getSettingNum('max_ramp_base', 6);
  let maxRampBuild = await getSettingNum('max_ramp_build', 4);
  const notes = [];

  if (adapt.underRecovery) {
    maxRampBase = Math.min(maxRampBase, 3);
    maxRampBuild = Math.min(maxRampBuild, 2);
    notes.push({
      type: 'ramp-capped',
      text: `Ramp cap reduced to ${maxRampBase} CTL/wk: EF is ${adapt.efChangePct}% vs the prior 6 weeks at matched IF while ATL rose to ${adapt.atl}. Building through that signal is how you get a plateau, not fitness.`,
    });
  }
  if (adapt.chronicUndercompliance) {
    maxRampBase = Math.min(maxRampBase, 4);
    notes.push({
      type: 'compliance',
      text: `Last ${adapt.complianceWeeks} weeks averaged ${adapt.compliancePct}% of planned TSS. Targets rebuilt from what you actually absorb (${adapt.actualWeeklyMean} TSS/wk), not from the previous plan's assumptions.`,
    });
  }

  // Starting weekly load: whichever of current CTL or recent real weekly load is
  // higher, so we never prescribe a step down into week 1 by accident.
  const startWeekly = Math.max(startCtl * 7, adapt.actualWeeklyMean || 0);

  const weeks = [];
  let ctl = startCtl;
  let lastLoadingTss = startWeekly;
  let peakLoadingTss = startWeekly;
  let blockIndex = 1;
  let weekInBlock = 1;

  // Where the ramp has to finish: last non-taper, non-race week.
  const rampEndIdx = seq.findIndex((p) => p === 'taper' || p === 'race');
  const rampWeeksTotal = (rampEndIdx === -1 ? seq.length : rampEndIdx) - indexOfWeek(firstWeek, planStartWeek);

  const longStart = Math.max(adapt.recentLongestHours || 0, 2);
  const longPeak = peakLongSessionHours(demand.hours, cls);

  for (let i = 0; i < seq.length; i++) {
    const ws = addDays(planStartWeek, i * 7);
    const phase = seq[i];

    if (ws < firstWeek) {
      const prior = await priorWeek(goal.id, ws);
      if (prior) {
        weeks.push({ ...prior, carriedOver: true });
        ctl = prior.projected_ctl ?? ctl;
        if (!prior.is_recovery) {
          lastLoadingTss = prior.target_tss ?? lastLoadingTss;
          peakLoadingTss = Math.max(peakLoadingTss, prior.target_tss ?? 0);
        }
        continue;
      }
    }

    const isRecovery = phase !== 'race' && phase !== 'taper' && weekInBlock > loadPattern;
    const dist = distributionFor(phase, cls);
    const tph = tssPerHour(dist);

    let targetTss;
    let governing = [];

    if (phase === 'race') {
      targetTss = round(eventTss + lastLoadingTss * 0.1, 0);
    } else if (phase === 'taper') {
      const taperIdx = i - seq.indexOf('taper');
      const taperLen = seq.filter((p) => p === 'taper').length;
      // Friel: hold frequency and intensity, cut duration progressively.
      const schedule =
        taperLen >= 3 ? [0.75, 0.55, 0.4] : taperLen === 2 ? [0.65, 0.45] : [0.5];
      const factor = schedule[Math.min(taperIdx, schedule.length - 1)];
      targetTss = round(peakLoadingTss * factor, 0);
    } else if (isRecovery) {
      targetTss = round(lastLoadingTss * 0.55, 0);
      governing.push({
        decision: 'recovery week',
        framework: 'Friel',
        reason: `Week ${weekInBlock} of a ${loadPattern}:1 block: load cut to 55% of the ${round(lastLoadingTss, 0)} TSS loading week so CTL consolidates and TSB comes back above -10.`,
      });
    } else {
      const remainingRamp = Math.max(1, rampWeeksTotal - weeks.filter((w) => !w.is_recovery).length);
      const gap = targetCtl - ctl;
      const cap = phase.startsWith('base') || phase === 'prep' ? maxRampBase : maxRampBuild;
      const wanted = clamp(gap / remainingRamp, -2, cap);
      // ΔCTL per week r requires weekly TSS = 7 × (CTL + 6r)  (from the 42-day EWMA)
      targetTss = round(7 * (ctl + 6 * wanted), 0);
      // Friel: no more than ~10% week-on-week volume increase inside a block.
      targetTss = Math.min(targetTss, round(lastLoadingTss * 1.1, 0));
      // and never above what the event actually justifies
      targetTss = Math.min(targetTss, round(pkHours * tph, 0));
      targetTss = Math.max(targetTss, round(ctl * 7 * 0.8, 0));
    }

    // Strength: dosed by calendar month against the athlete's own logged
    // seasonal pattern, not by training phase.
    let strength;
    if (phase === 'race') {
      strength = 0;
    } else if (phase === 'taper') {
      strength = 1;
      governing.push({
        decision: 'strength frequency',
        framework: 'Personal',
        reason: 'Taper: cut to 1×/wk regardless of season.',
      });
    } else {
      strength = seasonalStrengthSessions(ws);
      governing.push({
        decision: 'strength frequency',
        framework: 'Personal',
        reason: `${strength}×/wk for ${MONTH_NAMES[Number(ws.slice(5, 7)) - 1]} — logged seasonal pattern (1×/wk Jun-Aug, 2×/wk Mar-May & Sep-Nov, 3×/wk Dec-Feb), not tied to training phase.`,
      });
    }

    const hours = round(targetTss / tph, 1);
    const progress = rampWeeksTotal > 0 ? clamp(weeks.length / rampWeeksTotal, 0, 1) : 1;
    let longH = round(longStart + (longPeak - longStart) * Math.min(1, progress * 1.15), 1);
    if (isRecovery) longH = round(longH * 0.6, 1);
    if (phase === 'taper') longH = round(longPeak * 0.4, 1);
    if (phase === 'race') longH = round(demand.hours, 1);
    longH = Math.min(longH, round(hours * 0.6, 1) || longH);

    // Simulate CTL through the week (daily TSS = weekly/7, 42-day EWMA).
    let simCtl = ctl;
    for (let d = 0; d < 7; d++) simCtl += (targetTss / 7 - simCtl) / 42;
    ctl = simCtl;

    const ctx = { longHours: longH, strength, weekIndex: i };
    const sessions = keySessions(phase, cls, goal, ctx);

    weeks.push({
      week_index: i + 1,
      start_date: ws,
      end_date: addDays(ws, 6),
      phase,
      block_index: blockIndex,
      week_in_block: weekInBlock,
      is_recovery: isRecovery ? 1 : 0,
      target_tss: targetTss,
      target_hours: hours,
      z1_2_pct: dist.z1_2,
      z3_4_pct: dist.z3_4,
      z5_pct: dist.z5,
      long_session_h: longH,
      long_session_tss: round(longH * TSS_PER_HOUR.low * 1.05, 0),
      strength_sessions: strength,
      key_sessions_json: JSON.stringify(sessions),
      projected_ctl: round(ctl, 1),
      focus: focusFor(phase, cls),
      governing_json: JSON.stringify(governing),
      notes: null,
    });

    if (!isRecovery && phase !== 'taper' && phase !== 'race') {
      lastLoadingTss = targetTss;
      peakLoadingTss = Math.max(peakLoadingTss, targetTss);
    }
    if (isRecovery) {
      blockIndex++;
      weekInBlock = 1;
    } else {
      weekInBlock++;
    }
  }

  const achievableCtl = round(Math.max(...weeks.map((w) => w.projected_ctl || 0)), 0);
  if (achievableCtl < targetCtl - 5) {
    notes.push({
      type: 'ctl-gap',
      text: `The event profile (${round(demand.hours, 1)}h, ~${eventTss} TSS) justifies a peak CTL near ${targetCtl}. From CTL ${round(startCtl, 0)} with ${totalWeeks} weeks and a ${maxRampBase} CTL/wk cap in base, the plan reaches ${achievableCtl}. That gap is real: either accept a more conservative event pace, or extend the runway.`,
    });
  }

  const targetNote = checkTargetMetric(goal, athlete, startCtl, achievableCtl);
  if (targetNote) notes.push(targetNote);

  return {
    goal,
    demand: { ...demand, class: cls, eventIF: round(eventIF, 2), eventTss },
    targets: {
      targetCtl,
      achievableCtl,
      peakWeeklyHours: round(pkHours, 1),
      peakWeeklyTss: round(peakWeeklyTss, 0),
      peakLongHours: round(longPeak, 1),
      startCtl: round(startCtl, 1),
      maxRampBase,
      maxRampBuild,
    },
    adapt,
    notes,
    weeks,
    reason,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * goals.target_metric/target_value ("ftp" @ 260W, say) are stored on the goal
 * but otherwise never read anywhere. Check the ones we have a model for
 * (FTP/power) against this plan's projected fitness, using CTL growth as a
 * rough proxy for FTP growth — not physiologically exact, but enough to flag
 * a target that the plan's fitness build doesn't support. Anything else
 * (e.g. a pace target) is surfaced as unchecked rather than silently dropped.
 */
function checkTargetMetric(goal, athlete, startCtl, achievableCtl) {
  const metric = goal.target_metric ? String(goal.target_metric).trim().toLowerCase() : null;
  const value = goal.target_value;
  if (!metric || value == null) return null;

  if (metric === 'ftp' || metric === 'power') {
    if (!athlete.ftp) {
      return {
        type: 'target-unverified',
        text: `Target ${metric} of ${value}W is set, but no current FTP is on file — add one in Settings so this can be checked against the plan.`,
      };
    }
    const ctlGrowth = startCtl > 0 ? achievableCtl / startCtl : 1;
    const projectedFtp = round(athlete.ftp * clamp(ctlGrowth, 0.9, 1.35), 0);
    const gap = value - projectedFtp;
    if (gap > 5) {
      return {
        type: 'target-gap',
        text: `Target ${metric} is ${value}W. Current FTP is ${athlete.ftp}W; the fitness this plan builds (CTL ${round(startCtl, 0)} → ${achievableCtl}) projects to roughly ${projectedFtp}W by race week — ${round(gap, 0)}W short of target. FTP gains need dedicated threshold/VO2 work and time; check this again mid-plan against a real test, not this estimate.`,
      };
    }
    return {
      type: 'target-on-track',
      text: `Target ${metric} of ${value}W looks reachable: current FTP ${athlete.ftp}W projects to roughly ${projectedFtp}W by race week given this plan's fitness build.`,
    };
  }

  return {
    type: 'target-unchecked',
    text: `Target metric "${goal.target_metric}" (${value}) isn't one the planner checks automatically (supported: ftp/power) — it's stored on the goal for reference only.`,
  };
}

function indexOfWeek(ws, planStart) {
  return Math.max(0, Math.floor(daysBetween(planStart, ws) / 7));
}

async function priorWeek(goalId, ws) {
  return db
    .prepare(
      `SELECT pw.* FROM plan_weeks pw
       JOIN plans p ON p.id = pw.plan_id
       WHERE p.goal_id = ? AND pw.start_date = ?
       ORDER BY p.version DESC LIMIT 1`
    )
    .get(goalId, ws);
}

/**
 * The coach's explanation of the block, not just its label. Written the way
 * a coach would talk you through what this phase is *for* — what it builds,
 * why it comes where it does, what it should feel like — so the plan reads
 * as a reasoned progression rather than a table of numbers with a tag on it.
 */
function focusFor(phase, cls) {
  const longEvent = cls === 'ultra' || cls === 'long';
  const map = {
    prep: "General preparation. Before we load anything specific, we want consistency: getting the aerobic engine ticking over regularly, cleaning up cadence and pedalling technique, and building the habit of fuelling on the bike. Nothing here is hard by design — the whole point of this block is to arrive at base training already durable, so the real load doesn't have to double as an adaptation to just showing up.",
    base1: "Early aerobic base. This is where your season's fitness actually gets built — everything after this block is spending what gets deposited here. The work is deliberately polarized: long rides stay genuinely easy, and the week's one dose of intensity is short, maximal sprint efforts (SIT) early in the ride while neuromuscular freshness is highest — not moderate tempo. Sims is explicit that chronic time in that moderate gray zone raises cortisol without buying the adaptation real hard efforts do, so it's held near-empty by design, not just light. Strength work starts in earnest now too, while volume is still low enough to recover from it properly.",
    base2: "Aerobic base, extending. Same intent as the last block — build the engine — but the long ride grows and the SIT session picks up a rep or two. Still no tempo, still no sweet spot: easy stays easy, hard stays genuinely hard, and nothing gets parked in between. This is also usually where fuelling strategy for the event starts getting tested for real, not just practiced.",
    base3: "Late base. The SIT efforts get longer now (30–40 s, still maximal, still early in the ride) because your aerobic foundation is solid enough to absorb more top-end work without digging a hole you can't climb out of. Your longest rides step up close to what the build phase will demand — this is the bridge between \"building the engine\" and the threshold work build1 introduces.",
    build1: `Early build. The emphasis shifts from volume to specificity: threshold intervals${longEvent ? '' : ' start doing real work'}, and your long day starts looking like the event itself rather than just a big aerobic ride. ${longEvent ? "For an event this long, the specific work IS the duration and repeated days, not more intervals — time on feet, fuelling at race rate, and getting comfortable being uncomfortable for a long time matter more here than another hard interval set." : 'This is where fitness starts converting into race-specific capability rather than just raw aerobic volume.'}`,
    build2: `Peak build. This is the highest-load, highest-specificity block before you sharpen — ${longEvent ? 'back-to-back long days with full event kit and fuelling, rehearsing exactly what race day will ask of you' : 'VO2 work layered on top of race-pace blocks, run at full event fuelling'}. Expect to be tired here; that's the block doing its job, not a sign something's wrong, provided Form doesn't fall through the floor (that's what the weekly checks are for).`,
    peak: "Peak / specificity. Volume comes down, but intensity and specificity go up — this is dress-rehearsal territory: event kit, event fuelling, event position, on courses or efforts that mimic race day as closely as practical. The legs should start feeling sharper, not just less tired; if they don't, that's exactly the kind of thing the weekly brief should be flagging.",
    taper: 'Taper. The fitness for this event is already built — from here, the only job is to arrive on the start line rested without losing sharpness. Frequency and intensity hold; duration comes down. It is normal to feel restless or oddly fresh partway through a taper; that is the adaptation showing up, not fitness leaking away.',
    race: 'Race week. Nothing new gets built from here — the work is banked. Keep everything short, keep the legs moving, and trust the training that got you here.',
  };
  return map[phase] || '';
}

/**
 * Actual vs planned TSS over a set of weekly actuals (see recentWeeks) — split
 * out of adaptationInputs so callers that already have their own weekly
 * actuals (buildBrief) can get compliance numbers without also re-fetching
 * currentFitness/efTrend/recentWeeks a second time in the same request.
 */
export async function complianceWindow(weeks) {
  const actualWeekly = weeks.map((w) => w.tss || 0);
  const actualWeeklyMean = round(mean(actualWeekly), 0);

  const plannedRows = await Promise.all(
    weeks.map((w) =>
      db
        .prepare(
          `SELECT pw.target_tss FROM plan_weeks pw JOIN plans p ON p.id = pw.plan_id
           WHERE p.active = 1 AND pw.start_date = ? ORDER BY p.version DESC LIMIT 1`
        )
        .get(w.weekStart)
    )
  );
  const planned = plannedRows.map((pw) => pw?.target_tss || null).filter((x) => x != null);
  const plannedMean = round(mean(planned), 0);
  const compliancePct = plannedMean ? round(((actualWeeklyMean || 0) / plannedMean) * 100, 0) : null;

  return {
    actualWeeklyMean,
    plannedWeeklyMean: plannedMean,
    compliancePct,
    complianceWeeks: planned.length,
    chronicUndercompliance: compliancePct != null && compliancePct < 80 && planned.length >= 2,
  };
}

/** What actually happened recently — the input that makes replanning adaptive. */
export async function adaptationInputs(asOf = today()) {
  const [weeksAll, fitness, ef] = await Promise.all([recentWeeks(asOf, 5), currentFitness(asOf), efTrend(asOf)]);
  const weeks = weeksAll.slice(0, 4); // last 4 complete weeks
  const recentLongestHours = Math.max(0, ...weeks.map((w) => w.longestHours || 0));
  const compliance = await complianceWindow(weeks);

  const atlRising = weeks.length >= 2 && (weeks[weeks.length - 1].tss || 0) > (weeks[0].tss || 0);
  const underRecovery =
    ef.reliable && ef.changePct != null && ef.changePct <= -5 && (atlRising || (fitness.tsb ?? 0) < -20);

  return {
    ctl: round(fitness.ctl, 1),
    atl: round(fitness.atl, 1),
    tsb: round(fitness.tsb, 1),
    efChangePct: ef.changePct,
    efReliable: ef.reliable,
    ...compliance,
    recentLongestHours: round(recentLongestHours, 1),
    underRecovery: !!underRecovery,
  };
}

// --- persistence ------------------------------------------------------------

export async function savePlan(result) {
  const goalId = result.goal.id;
  const prev = await db.prepare('SELECT MAX(version) v FROM plans WHERE goal_id = ?').get(goalId);
  const version = (prev?.v || 0) + 1;

  return dbTransaction(async (tx) => {
    await tx.run('UPDATE plans SET active = 0 WHERE goal_id = ?', [goalId]);
    const info = await tx.run(
      `INSERT INTO plans (goal_id, version, generated_at, reason, params_json, notes_json, active)
       VALUES (?,?,?,?,?,?,1)`,
      [
        goalId,
        version,
        result.generatedAt,
        result.reason,
        JSON.stringify({ demand: result.demand, targets: result.targets, adapt: result.adapt }),
        JSON.stringify(result.notes),
      ]
    );
    const planId = Number(info.lastInsertRowid);
    for (const w of result.weeks) {
      await tx.run(
        `INSERT INTO plan_weeks (plan_id, week_index, start_date, end_date, phase, block_index, week_in_block,
          is_recovery, target_tss, target_hours, z1_2_pct, z3_4_pct, z5_pct, long_session_h, long_session_tss,
          strength_sessions, key_sessions_json, projected_ctl, focus, governing_json, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          planId, w.week_index, w.start_date, w.end_date, w.phase, w.block_index ?? null, w.week_in_block ?? null,
          w.is_recovery ?? 0, w.target_tss ?? null, w.target_hours ?? null, w.z1_2_pct ?? null, w.z3_4_pct ?? null,
          w.z5_pct ?? null, w.long_session_h ?? null, w.long_session_tss ?? null, w.strength_sessions ?? null,
          w.key_sessions_json ?? null, w.projected_ctl ?? null, w.focus ?? null, w.governing_json ?? null,
          w.notes ?? null,
        ]
      );
    }
    return { planId, version };
  });
}

export async function activePlan(goalId) {
  return db.prepare('SELECT * FROM plans WHERE goal_id = ? AND active = 1 ORDER BY version DESC LIMIT 1').get(goalId);
}

export async function planWeeks(planId) {
  return db.prepare('SELECT * FROM plan_weeks WHERE plan_id = ? ORDER BY start_date').all(planId);
}

export async function weekForDate(planId, date) {
  const ws = weekStart(date);
  return db.prepare('SELECT * FROM plan_weeks WHERE plan_id = ? AND start_date = ?').get(planId, ws);
}

export async function activeGoal() {
  return (await db.prepare("SELECT * FROM goals WHERE status = 'active' ORDER BY event_date LIMIT 1").get()) || null;
}

export async function regenerate(goalId, reason = 'weekly-adaptive') {
  const result = await generatePlan(goalId, { reason });
  const saved = await savePlan(result);
  return { ...saved, result };
}
