// Per-workout coach's debrief (server/debrief.js): a single ride evaluated
// against the athlete's own recent baseline and, where a plan is active,
// against this week's targets.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aicoach-debrief-test-'));
process.env.AICOACH_DB = join(dir, 'test.db');

const { db, upsertAthlete } = await import('../server/db.js');
const { addDays, today } = await import('../server/util.js');
const planner = await import('../server/planner.js');
const { buildWorkoutDebrief } = await import('../server/debrief.js');

process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

const TODAY = today();
let seq = 0;

async function seedActivity({
  id, date, type = 'Ride', name = 'Ride', movingTime = 5400, tss = 60, intensity = 0.7,
  np = 200, avgHr = 140, vi = 1.03, ef = 1.55, decoupling = null, wbalDrop = null,
}) {
  const actId = id || `act-${seq++}`;
  const avgPower = np != null && vi != null ? Math.round(np / vi) : null;
  await db
    .prepare(
      `INSERT OR REPLACE INTO activities
       (id, date, type, name, moving_time, tss, intensity, np, avg_power, vi, ef, avg_hr, decoupling, wbal_drop, w_prime, synced_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(actId, date, type, name, movingTime, tss, intensity, np, avgPower, vi, ef, avgHr, decoupling, wbalDrop, 22000, new Date().toISOString());
  return actId;
}

async function seedRideLog(activityId, { date, rpe = null, back_pain = null, position = null, drops_minutes = null }) {
  await db
    .prepare(
      `INSERT INTO ride_logs (activity_id, date, rpe, back_pain, position, drops_minutes, source, created_at, updated_at)
       VALUES (?,?,?,?,?,?,'manual',?,?)`
    )
    .run(activityId, date, rpe, back_pain, position, drops_minutes, new Date().toISOString(), new Date().toISOString());
}

test('buildWorkoutDebrief returns null for an unknown activity', async () => {
  assert.equal(await buildWorkoutDebrief('does-not-exist'), null);
});

test('debrief works with no ride log and no active goal — nothing crashes, no plan-fit flags', async () => {
  const id = await seedActivity({ date: addDays(TODAY, -200), intensity: 0.7, ef: 1.55, movingTime: 3000 });
  const d = await buildWorkoutDebrief(id);
  assert.equal(d.activityId, id);
  assert.equal(d.role, 'endurance');
  assert.ok(!d.flags.some((f) => f.id === 'week-progress' || f.id === 'long-vs-plan'));
});

test('EF below baseline at matched IF flags a warn; above baseline flags good', async () => {
  const base = addDays(TODAY, -300);
  for (let i = 0; i < 8; i++) {
    await seedActivity({ date: addDays(base, i * 5), intensity: 0.7, ef: 1.55, movingTime: 5400 });
  }
  const worseId = await seedActivity({ date: addDays(base, 45), intensity: 0.7, ef: 1.35, movingTime: 5400, vi: 1.18, decoupling: 9.5 });
  const worse = await buildWorkoutDebrief(worseId);
  const efFlag = worse.flags.find((f) => f.id === 'ef');
  assert.ok(efFlag, 'expected an EF flag');
  assert.equal(efFlag.severity, 'warn');
  assert.ok(efFlag.text.includes('1.35'));

  const viFlag = worse.flags.find((f) => f.id === 'vi');
  assert.ok(viFlag, 'expected a pacing (VI) flag');
  assert.equal(viFlag.severity, 'warn');

  const decoup = worse.flags.find((f) => f.id === 'decoupling');
  assert.ok(decoup, 'expected a decoupling flag');

  const betterId = await seedActivity({ date: addDays(base, 46), intensity: 0.7, ef: 1.75, movingTime: 5400, vi: 1.02 });
  const better = await buildWorkoutDebrief(betterId);
  const efGood = better.flags.find((f) => f.id === 'ef-good');
  assert.ok(efGood, 'expected an above-baseline EF flag');
  assert.equal(efGood.severity, 'good');
  assert.ok(!better.flags.some((f) => f.id === 'vi'));
});

test('RPE vs numbers: high RPE at a low IF flags "felt harder"; logged back pain is surfaced', async () => {
  const id = await seedActivity({ date: addDays(TODAY, -50), intensity: 0.68, ef: 1.5, movingTime: 5400 });
  await seedRideLog(id, { date: addDays(TODAY, -50), rpe: 9, back_pain: 'moderate', position: 'drops', drops_minutes: 40 });
  const d = await buildWorkoutDebrief(id);
  const rpeFlag = d.flags.find((f) => f.id === 'rpe-harder');
  assert.ok(rpeFlag, 'expected a "felt harder than the numbers show" flag');

  const painFlag = d.flags.find((f) => f.id === 'back-pain');
  assert.ok(painFlag);
  assert.equal(painFlag.severity, 'info');
  assert.ok(painFlag.text.includes('drops'));
});

test("W' consumed deeper than usual at matched NP flags a warn", async () => {
  const base = addDays(TODAY, -60);
  for (let i = 0; i < 4; i++) {
    await seedActivity({ date: addDays(base, i * 6), intensity: 0.85, np: 250, wbalDrop: 15000, movingTime: 3600 });
  }
  const id = await seedActivity({ date: addDays(base, 25), intensity: 0.85, np: 252, wbalDrop: 19000, movingTime: 3600 });
  const d = await buildWorkoutDebrief(id);
  const wbalFlag = d.flags.find((f) => f.id === 'wbal');
  assert.ok(wbalFlag, 'expected a W\'bal flag');
  assert.equal(wbalFlag.severity, 'warn');
});

test('role classification: longest ride of the week is "long", a weights session is "strength"', async () => {
  const ws = addDays(TODAY, -400 - ((400) % 7)); // arbitrary Monday-ish week far from other tests' data
  await seedActivity({ date: ws, intensity: 0.65, movingTime: 3600, name: 'Easy spin' });
  const longId = await seedActivity({ date: addDays(ws, 3), intensity: 0.62, movingTime: 4 * 3600, name: 'Long endurance' });
  const strengthId = await seedActivity({ date: addDays(ws, 5), type: 'WeightTraining', name: 'Strength', movingTime: 2700, tss: 0, intensity: null, np: null, ef: null, vi: null });

  const long = await buildWorkoutDebrief(longId);
  assert.equal(long.role, 'long');

  const strength = await buildWorkoutDebrief(strengthId);
  assert.equal(strength.role, 'strength');
});

test('plan-fit: a short long-session ride flags against the plan, and week TSS progress is reported', async () => {
  await upsertAthlete({ ftp: 230, weight_kg: 62, max_hr: 186, threshold_hr: 168 });
  // The planner sizes each week's target_tss off the athlete's current fitness
  // (CTL), so a goal created cold — no training history at all — plans every
  // week at 0 TSS. Give it a baseline to ramp from, same as a real athlete
  // creating a goal after months of logged riding.
  for (let i = 120; i >= 1; i--) {
    await seedActivity({ date: addDays(TODAY, -i), tss: 90, intensity: 0.7, movingTime: 7200, ef: 1.5 });
  }
  const info = await db
    .prepare(
      `INSERT INTO goals (name, kind, sport, event_date, start_date, priority, distance_km, elevation_m, support, status, created_at)
       VALUES ('Test goal','event','Ride',?,?,'A',160,2000,'supported','active',?)`
    )
    .run(addDays(TODAY, 7 * 20), TODAY, new Date().toISOString());
  const goalId = Number(info.lastInsertRowid);
  const result = await planner.generatePlan(goalId, { reason: 'test' });
  await planner.savePlan(result);

  // Loading (non-recovery, non-taper) week with the biggest long-session target —
  // guaranteed to exist once the plan has any loading weeks at all.
  const loading = result.weeks.filter((w) => !w.is_recovery && !['taper', 'race'].includes(w.phase) && w.long_session_h > 0);
  const week = loading.reduce((m, w) => (w.long_session_h > (m?.long_session_h || 0) ? w : m), null);
  assert.ok(week, 'expected a loading week with a long session target');

  const shortLongId = await seedActivity({
    date: week.start_date, intensity: 0.62, movingTime: (week.long_session_h * 0.4) * 3600, name: 'Long ride',
  });
  const d = await buildWorkoutDebrief(shortLongId);
  assert.equal(d.role, 'long');
  const planFlag = d.flags.find((f) => f.id === 'long-vs-plan');
  assert.ok(planFlag, 'expected a long-vs-plan flag');
  assert.equal(planFlag.severity, 'warn');

  const progress = d.flags.find((f) => f.id === 'week-progress');
  assert.ok(progress, 'expected a week-progress flag');
  assert.match(progress.text, new RegExp(`of ${week.target_tss} planned TSS`));
});
