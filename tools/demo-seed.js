#!/usr/bin/env node
// Populate a *separate* demo database with a synthetic athlete so you can see
// the app working before wiring up your intervals.icu key.
//
//   node tools/demo-seed.js               → writes data/demo.db
//   AICOACH_DB=data/demo.db npm start     → run the app against it
//
// It refuses to touch the default database.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = process.env.AICOACH_DB || resolve(here, '..', 'data', 'demo.db');
if (/aicoach\.db$/.test(target)) {
  console.error('Refusing to seed the primary database. Set AICOACH_DB to something else.');
  process.exit(1);
}
process.env.AICOACH_DB = target;

const { db, upsertAthlete } = await import('../server/db.js');
const { addDays, today, weekStart } = await import('../server/util.js');
const planner = await import('../server/planner.js');
const brief = await import('../server/brief.js');

await db.exec('DELETE FROM activities; DELETE FROM ride_logs; DELETE FROM daily_logs; DELETE FROM briefs; DELETE FROM plan_weeks; DELETE FROM plans; DELETE FROM goals;');

const TODAY = today();
await upsertAthlete({ name: 'Demo athlete', ftp: 232, weight_kg: 61.5, max_hr: 186, threshold_hr: 168 });

// 26 weeks of history: a 3:1 block structure with a hard final fortnight and a
// deliberate EF slide, so the brief has something real to react to.
let n = 0;
const rand = (() => { let s = 7; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })();

for (let d = 180; d >= 0; d--) {
  const date = addDays(TODAY, -d);
  const dow = new Date(date + 'T12:00:00Z').getUTCDay();
  if (dow === 1) continue; // Monday off
  const weekIdx = Math.floor((180 - d) / 7);
  const recovery = weekIdx % 4 === 3;
  const fatigued = d <= 16; // recent overload block

  const isLong = dow === 6;
  const isHard = dow === 3 || dow === 5;
  let hours = isLong ? 3.5 + weekIdx * 0.09 : isHard ? 1.5 : 1.8;
  if (recovery) hours *= 0.55;
  if (fatigued && !recovery) hours *= 1.35;

  const intensity = isHard ? 0.84 + rand() * 0.05 : isLong ? 0.66 + rand() * 0.04 : 0.62 + rand() * 0.05;
  const np = Math.round(232 * intensity * (0.98 + rand() * 0.04));
  // HR drifts up in the last three weeks at the same power → EF falls.
  const hrPenalty = d < 24 ? 1.07 : 1.0;
  const avgHr = Math.round((np / 1.48) * hrPenalty * (0.98 + rand() * 0.04));
  const vi = isLong ? 1.05 + rand() * 0.07 : 1.03 + rand() * 0.03;
  const tss = Math.round(hours * intensity * intensity * 100);
  const position = isHard ? (rand() > 0.35 ? 'drops' : 'upright') : rand() > 0.7 ? 'drops' : 'upright';
  // The pattern being monitored: pain shows up on hard drops rides.
  const painRoll = rand();
  const pain = isHard && position === 'drops' ? (painRoll > 0.45 ? (painRoll > 0.85 ? 'flare' : 'moderate') : 'none')
    : painRoll > 0.94 ? 'mild' : 'none';

  const id = `demo-${date}-${dow}`;
  await db
    .prepare(
      `INSERT INTO activities (id, date, start_local, type, name, moving_time, distance_m, elevation_m, tss,
       intensity, np, avg_power, max_power, vi, ef, avg_hr, trimp, w_prime, wbal_min, wbal_drop, z_times_json, synced_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      id, date, `${date}T07:00:00`, 'Ride',
      isLong ? 'Long endurance' : isHard ? 'Threshold intervals' : 'Endurance',
      Math.round(hours * 3600), Math.round(hours * 27000), Math.round(hours * (isLong ? 700 : 400)),
      tss, Math.round(intensity * 100) / 100, np, Math.round(np / vi), Math.round(np * 2.4),
      Math.round(vi * 1000) / 1000, Math.round((np / avgHr) * 1000) / 1000, avgHr, Math.round(tss * 0.9),
      21500, isHard ? Math.round(6000 - (24 - Math.min(d, 24)) * 120) : 15000,
      isHard ? Math.round(15500 + (24 - Math.min(d, 24)) * 120) : 6500,
      JSON.stringify([
        Math.round(hours * 3600 * (isHard ? 0.45 : 0.6)), Math.round(hours * 3600 * (isHard ? 0.25 : 0.32)),
        Math.round(hours * 3600 * (isHard ? 0.12 : 0.06)), Math.round(hours * 3600 * (isHard ? 0.13 : 0.02)),
        Math.round(hours * 3600 * (isHard ? 0.05 : 0)), 0, 0,
      ]),
      new Date().toISOString()
    );
  await db
    .prepare(
      `INSERT INTO ride_logs (activity_id, date, position, back_pain, rpe, source, created_at, updated_at)
     VALUES (?,?,?,?,?,'manual',?,?)`
    )
    .run(id, date, position, pain, Math.round(3 + intensity * 6), new Date().toISOString(), new Date().toISOString());
  n++;
}

// Wellness: resting HR creeping up over the overload block.
for (let d = 180; d >= 0; d--) {
  const date = addDays(TODAY, -d);
  await db
    .prepare('INSERT OR REPLACE INTO wellness (date, resting_hr, hrv, weight, sleep_secs, raw_json) VALUES (?,?,?,?,?,?)')
    .run(date, 46 + (d < 21 ? 4 : 0) + Math.round(rand() * 2), 78 - (d < 21 ? 9 : 0), 61.5 - (d < 30 ? 0.6 : 0), 26000, '{}');
}

const goalInfo = await db
  .prepare(
    `INSERT INTO goals (name, kind, sport, event_date, start_date, priority, distance_km, elevation_m,
      support, terrain, notes, status, created_at)
     VALUES ('Bright Midnight ultra','event','Ride',?,?,'A',1100,20000,'self-supported','mountain',
       'Demo goal seeded by tools/demo-seed.js','active',?)`
  )
  .run(addDays(TODAY, 7 * 22), addDays(weekStart(TODAY), -7 * 4), new Date().toISOString());

const goalId = Number(goalInfo.lastInsertRowid);
const res = await planner.regenerate(goalId, 'demo seed');
const b = await brief.runWeekly({ goalId, asOf: TODAY, replan: false });

console.log(`Seeded ${n} activities into ${target}`);
console.log(`Plan v${res.version}: ${res.result.weeks.length} weeks, peak CTL ${res.result.targets.achievableCtl} (target ${res.result.targets.targetCtl})`);
for (const note of res.result.notes) console.log(`  • ${note.text}`);
console.log(`\nRun it:  AICOACH_DB=${target} npm start\n`);
console.log('--- this week\'s brief ---\n');
console.log(b.brief.body_md);
