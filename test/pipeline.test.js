// End-to-end exercise of the domain logic against a synthetic athlete.
// Uses a throwaway database so it never touches real data.
//
// Everything here is async now: the storage layer may be a networked DB on
// Vercel (see server/dbdriver.js), so every DB-touching function in the app
// returns a Promise even when running against the local sqlite file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aicoach-test-'));
process.env.AICOACH_DB = join(dir, 'test.db');

const { db, setSetting, upsertAthlete } = await import('../server/db.js');
const { addDays, weekStart, today } = await import('../server/util.js');
const metrics = await import('../server/metrics.js');
const planner = await import('../server/planner.js');
const brief = await import('../server/brief.js');
const backpain = await import('../server/backpain.js');
const { normaliseActivity, parseTags } = await import('../server/sync.js');
const intervalsClient = await import('../server/intervals.js');

process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

const TODAY = today();

async function seedActivity({ date, tss, intensity, np = 200, avgHr = 140, movingTime = 3600 * 2, vi = 1.04, name = 'Ride', wbalDrop = null, desc = null }) {
  await db
    .prepare(
      `INSERT OR REPLACE INTO activities (id, date, type, name, description, moving_time, tss, intensity, np,
      avg_power, vi, ef, avg_hr, wbal_drop, w_prime, z_times_json, synced_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      `${date}-${Math.random().toString(36).slice(2, 8)}`, date, 'Ride', name, desc, movingTime, tss, intensity, np,
      Math.round(np / vi), vi, np / avgHr, avgHr, wbalDrop, 22000,
      JSON.stringify([movingTime * 0.5, movingTime * 0.35, movingTime * 0.1, movingTime * 0.05, 0, 0, 0]),
      new Date().toISOString()
    );
}

test('parseTags reads the intervals.icu description convention', () => {
  assert.deepEqual(parseTags('Long one #drops:95 #pain:moderate #rpe:8'), {
    drops_minutes: 95, position: 'drops', back_pain: 'moderate', rpe: 8,
  });
  assert.equal(parseTags('nothing here'), null);
  assert.equal(parseTags('Hills #upright #rpe:6').position, 'upright');
});

test('normaliseActivity derives VI and EF when intervals omits them', () => {
  const a = normaliseActivity({
    id: 42, start_date_local: '2026-05-01T07:00:00', type: 'Ride', moving_time: 7200,
    icu_weighted_avg_watts: 210, icu_average_watts: 200, average_heartrate: 140,
    icu_training_load: 150, icu_intensity: 0.75, icu_w_prime: 20000, icu_wbal_min: 6000,
  });
  assert.equal(a.date, '2026-05-01');
  assert.equal(a.vi, 210 / 200);
  assert.equal(a.ef, 1.5);
  assert.equal(a.wbal_drop, 14000);
  assert.equal(a.tsb, null); // no ctl/atl supplied
});

test('fitness series computes CTL/ATL/TSB from load', async () => {
  for (let i = 120; i >= 0; i--) await seedActivity({ date: addDays(TODAY, -i), tss: 90, intensity: 0.7 });
  const cur = await metrics.currentFitness(TODAY);
  // 90 TSS/day sustained for 120 days → CTL approaches 90
  assert.ok(cur.ctl > 80 && cur.ctl <= 91, `CTL was ${cur.ctl}`);
  assert.ok(Math.abs(cur.tsb) < 6, `TSB was ${cur.tsb}`);
  assert.equal((await metrics.rampRate(TODAY)) != null, true);
});

test('event demand model handles a self-supported mountain ultra', () => {
  const d = planner.estimateDuration({
    sport: 'Ride', distance_km: 1100, elevation_m: 20000, support: 'self-supported', kind: 'event',
  });
  assert.ok(d.hours > 45 && d.hours < 80, `estimated ${d.hours}h`);
  assert.equal(planner.durationClass(d.hours), 'ultra');
  assert.ok(d.elapsedHours > d.hours);
  // A short metric goal lands in a different class with a different distribution.
  const short = planner.estimateDuration({ sport: 'Ride', kind: 'metric' });
  assert.equal(planner.durationClass(short.hours), 'sprint');
  assert.ok(planner.distributionFor('peak', 'sprint').z5 > planner.distributionFor('peak', 'ultra').z5);
});

test('phase allocation is ordered and covers every week', () => {
  const seq = planner.allocatePhases(30, 60, 70, 120);
  assert.equal(seq.length, 30);
  assert.equal(seq[seq.length - 1], 'race');
  assert.equal(seq.filter((p) => p === 'taper').length, 3); // >15h event
  const order = ['prep', 'base1', 'base2', 'base3', 'build1', 'build2', 'peak', 'taper', 'race'];
  let last = -1;
  for (const p of seq) {
    const idx = order.indexOf(p);
    assert.ok(idx >= last, `phase ${p} came after ${order[last]}`);
    last = idx;
  }
  // Short runways degrade instead of throwing.
  assert.equal(planner.allocatePhases(4, 3, 40, 60).length, 4);
  assert.equal(planner.allocatePhases(1, 3, 40, 60).length, 1);
});

let goalId;
test('plan generation produces a periodized, ramping, recovery-punctuated plan', async () => {
  await upsertAthlete({ ftp: 230, weight_kg: 62, max_hr: 186, threshold_hr: 168 });
  const info = await db
    .prepare(
      `INSERT INTO goals (name, kind, sport, event_date, start_date, priority, distance_km, elevation_m, support, status, created_at)
       VALUES ('Bright Midnight ultra','event','Ride',?,?,'A',1100,20000,'self-supported','active',?)`
    )
    .run(addDays(TODAY, 7 * 28), TODAY, new Date().toISOString());
  goalId = Number(info.lastInsertRowid);

  const result = await planner.generatePlan(goalId, { reason: 'test' });
  assert.ok(result.weeks.length >= 28, `got ${result.weeks.length} weeks`);
  assert.equal(result.weeks[result.weeks.length - 1].phase, 'race');
  assert.ok(result.demand.hours > 45);

  // Every 4th week in a 3:1 pattern is a recovery week.
  const recoveries = result.weeks.filter((w) => w.is_recovery);
  assert.ok(recoveries.length >= 4, `only ${recoveries.length} recovery weeks`);
  for (const r of recoveries) {
    assert.ok(r.target_tss > 0);
  }

  // Load ramps: peak loading week is meaningfully above the first.
  const loading = result.weeks.filter((w) => !w.is_recovery && !['taper', 'race'].includes(w.phase));
  assert.ok(Math.max(...loading.map((w) => w.target_tss)) > loading[0].target_tss * 1.15);

  // Taper cuts volume below the peak.
  const taper = result.weeks.filter((w) => w.phase === 'taper');
  assert.ok(taper.length >= 2);
  assert.ok(taper[taper.length - 1].target_tss < Math.max(...loading.map((w) => w.target_tss)) * 0.5);

  // Ultra distribution stays aerobic even at peak.
  const peak = result.weeks.find((w) => w.phase === 'peak');
  assert.ok(peak.z1_2_pct >= 80, `peak Z1-2 was ${peak.z1_2_pct}%`);

  // Strength dosing follows the athlete's own logged seasonal pattern (a
  // Personal calibration, not a Friel or Sims rule), not training phase.
  for (const w of result.weeks.filter((w) => !['taper', 'race'].includes(w.phase))) {
    assert.equal(w.strength_sessions, planner.seasonalStrengthSessions(w.start_date));
    const gov = JSON.parse(w.governing_json);
    assert.ok(gov.some((g) => g.decision === 'strength frequency' && g.framework === 'Personal'));
  }
  for (const w of result.weeks.filter((w) => w.phase === 'taper')) {
    assert.equal(w.strength_sessions, 1);
  }
  const raceWeek = result.weeks.find((w) => w.phase === 'race');
  assert.equal(raceWeek.strength_sessions, 0);

  const saved = await planner.savePlan(result);
  assert.equal(saved.version, 1);
  assert.equal((await planner.planWeeks(saved.planId)).length, result.weeks.length);
});

test('regeneration preserves past weeks and bumps the version', async () => {
  const before = await planner.activePlan(goalId);
  const firstWeek = (await planner.planWeeks(before.id))[0];
  const r = await planner.regenerate(goalId, 'test-regen');
  assert.equal(r.version, 2);
  const after = await planner.planWeeks(r.planId);
  assert.equal(after[0].start_date, firstWeek.start_date);
  assert.equal((await planner.activePlan(goalId)).version, 2);
  // Only one active plan at a time.
  const count = await db.prepare('SELECT COUNT(*) c FROM plans WHERE goal_id = ? AND active = 1').get(goalId);
  assert.equal(count.c, 1);
});

test('target_metric/target_value are checked against the plan\'s projected fitness', async () => {
  // A target the plan's FTP growth can't plausibly reach: note this out loud.
  const farInfo = await db
    .prepare(
      `INSERT INTO goals (name, kind, sport, event_date, start_date, priority, distance_km, elevation_m, support,
         target_metric, target_value, status, created_at)
       VALUES ('FTP test','metric','Ride',?,?,'A',null,null,'supported','ftp',400,'active',?)`
    )
    .run(addDays(TODAY, 7 * 16), TODAY, new Date().toISOString());
  const farGoalId = Number(farInfo.lastInsertRowid);
  const far = await planner.generatePlan(farGoalId, { reason: 'test-target' });
  assert.ok(far.notes.some((n) => n.type === 'target-gap' && /400W/.test(n.text)));

  // A target well below current FTP: always reachable regardless of this
  // plan's exact CTL trajectory, so this must never read as a gap.
  const nearInfo = await db
    .prepare(
      `INSERT INTO goals (name, kind, sport, event_date, start_date, priority, support,
         target_metric, target_value, status, created_at)
       VALUES ('FTP test near','metric','Ride',?,?,'A','supported','power',200,'active',?)`
    )
    .run(addDays(TODAY, 7 * 16), TODAY, new Date().toISOString());
  const nearGoalId = Number(nearInfo.lastInsertRowid);
  const near = await planner.generatePlan(nearGoalId, { reason: 'test-target' });
  assert.ok(near.notes.some((n) => n.type === 'target-on-track'));
  assert.ok(!near.notes.some((n) => n.type === 'target-gap'));

  // A metric the planner has no model for: surfaced as unchecked, not silently dropped.
  const paceInfo = await db
    .prepare(
      `INSERT INTO goals (name, kind, sport, event_date, start_date, priority, support,
         target_metric, target_value, status, created_at)
       VALUES ('Pace test','metric','Run',?,?,'A','supported','pace',4.5,'active',?)`
    )
    .run(addDays(TODAY, 7 * 16), TODAY, new Date().toISOString());
  const paceGoalId = Number(paceInfo.lastInsertRowid);
  const pace = await planner.generatePlan(paceGoalId, { reason: 'test-target' });
  assert.ok(pace.notes.some((n) => n.type === 'target-unchecked' && /pace/.test(n.text)));

  // No target set at all: no target-related note, and nothing throws.
  const noneInfo = await db
    .prepare(
      `INSERT INTO goals (name, kind, sport, event_date, start_date, priority, support, status, created_at)
       VALUES ('No target test','metric','Ride',?,?,'A','supported','active',?)`
    )
    .run(addDays(TODAY, 7 * 16), TODAY, new Date().toISOString());
  const noneGoalId = Number(noneInfo.lastInsertRowid);
  const none = await planner.generatePlan(noneGoalId, { reason: 'test-target' });
  assert.ok(!none.notes.some((n) => n.type?.startsWith('target-')));
});

test('brief cites numbers and reacts to deep fatigue', async () => {
  const b1 = await brief.buildBrief({ goalId, asOf: TODAY });
  assert.ok(b1.headline.length > 0);
  assert.match(b1.body, /CTL \d/);
  assert.ok(b1.metrics.tsb != null);

  // Bury the athlete: two weeks of very high load.
  for (let i = 13; i >= 0; i--) {
    await seedActivity({ date: addDays(TODAY, -i), tss: 320, intensity: 0.82, np: 215, avgHr: 155 });
  }
  const b2 = await brief.buildBrief({ goalId, asOf: TODAY });
  assert.ok(b2.metrics.tsb < -20, `TSB was ${b2.metrics.tsb}`);
  assert.match(b2.headline, /Z2|Cut|cut/);
  // The directive must quote the actual TSB number, not a vague hedge.
  assert.match(b2.headline + b2.body, new RegExp(String(Math.round(b2.metrics.tsb))));
  assert.ok(b2.flags.some((f) => f.id === 'form'));

  const saved = await brief.saveBrief(b2);
  assert.equal(saved.week_start, weekStart(TODAY));
  assert.ok(saved.body_md.includes('Where you are'));
});

test('brief contains no filler advice', async () => {
  const b = await brief.buildBrief({ goalId, asOf: TODAY });
  const text = (b.body + b.actions.join(' ') + b.flags.map((f) => f.text).join(' ')).toLowerCase();
  for (const banned of ['listen to your body', 'consider recovery', 'as needed', 'if you feel']) {
    assert.ok(!text.includes(banned), `brief contained filler: "${banned}"`);
  }
  // Every action must contain at least one digit.
  for (const a of b.actions) assert.match(a, /\d/, `action without a number: ${a}`);
});

test('EF decline at matched IF while load rises reads as under-recovery', async () => {
  // Wipe and rebuild a history with a deliberate EF collapse at constant IF.
  await db.exec('DELETE FROM activities');
  for (let i = 90; i >= 43; i--) {
    await seedActivity({ date: addDays(TODAY, -i), tss: 100, intensity: 0.7, np: 200, avgHr: 135, movingTime: 5400 });
  }
  for (let i = 42; i >= 0; i--) {
    // Same IF and NP, higher HR → EF down ~10%; and more load per day.
    await seedActivity({ date: addDays(TODAY, -i), tss: 200, intensity: 0.71, np: 200, avgHr: 150, movingTime: 7200 });
  }
  const ef = await metrics.efTrend(TODAY);
  assert.equal(ef.reliable, true);
  assert.ok(ef.changePct <= -5, `EF change was ${ef.changePct}%`);

  const adapt = await planner.adaptationInputs(TODAY);
  assert.equal(adapt.underRecovery, true);

  const b = await brief.buildBrief({ goalId, asOf: TODAY });
  const flag = b.flags.find((f) => f.id === 'under-recovery');
  assert.ok(flag, 'expected an under-recovery flag');
  assert.match(flag.text, /EF is down/);
  assert.match(flag.text, /-\d/);

  // And the plan must actually respond, not just describe.
  const re = await planner.generatePlan(goalId, { reason: 'test-underrecovery' });
  assert.ok(re.targets.maxRampBase <= 3, `ramp cap was ${re.targets.maxRampBase}`);
  assert.ok(re.notes.some((n) => n.type === 'ramp-capped'));
});

test('an adjustment is applied to the plan week, not just described', async () => {
  // The EF-collapse history from the previous test leaves the athlete buried.
  const plan = await planner.activePlan(goalId);
  const wsNow = weekStart(TODAY);
  const before = await db.prepare('SELECT * FROM plan_weeks WHERE plan_id = ? AND start_date = ?').get(plan.id, wsNow);
  assert.ok(before, 'expected a plan week for the current week');

  const b = await brief.buildBrief({ goalId, asOf: TODAY });
  const after = await db.prepare('SELECT * FROM plan_weeks WHERE plan_id = ? AND start_date = ?').get(plan.id, wsNow);

  assert.ok(after.target_tss < before.target_tss, 'plan week should have been cut');
  assert.equal(after.z5_pct, 0, 'intensity allocation should be zeroed');
  assert.equal(Math.round(after.z1_2_pct + after.z3_4_pct + after.z5_pct), 100);

  // The single-number invariant: whatever the brief says, the plan week says.
  assert.ok(b.body.includes(`| TSS | ${after.target_tss} |`), 'brief table must show the adjusted TSS');
  assert.ok(b.headline.includes(String(after.target_tss)), `headline "${b.headline}" must quote ${after.target_tss}`);
  const others = [before.target_tss, Math.round(before.target_tss * 0.75), Math.round(before.target_tss * 0.5)]
    .filter((v) => v !== after.target_tss);
  for (const v of others) {
    assert.ok(!b.headline.includes(String(v)), `headline must not quote the stale target ${v}`);
  }
  // And the change is recorded with its framework.
  const gov = JSON.parse(after.governing_json).find((g) => /in-week adjustment/.test(g.decision));
  assert.ok(gov && gov.framework === 'Friel' && /\d/.test(gov.reason));
});

test('back pain correlation separates position from distance', async () => {
  await db.exec('DELETE FROM activities; DELETE FROM ride_logs;');
  const mk = async (date, { intensity, position, pain, hours }) => {
    const id = `act-${date}`;
    await db
      .prepare(
        `INSERT INTO activities (id, date, type, name, moving_time, tss, intensity, np, avg_power, vi, avg_hr, ef, synced_at)
       VALUES (?,?,'Ride','r',?,?,?,200,190,1.05,140,1.4,?)`
      )
      .run(id, date, hours * 3600, intensity * hours * 100, intensity, new Date().toISOString());
    await db
      .prepare(
        `INSERT INTO ride_logs (activity_id, date, position, back_pain, source, created_at, updated_at)
       VALUES (?,?,?,?,'manual',?,?)`
      )
      .run(id, date, position, pain, new Date().toISOString(), new Date().toISOString());
  };
  // 6 high-IF drops rides, 4 with pain; 4 high-IF upright rides, none with pain.
  const hi = 0.85;
  await mk(addDays(TODAY, -2), { intensity: hi, position: 'drops', pain: 'moderate', hours: 2 });
  await mk(addDays(TODAY, -4), { intensity: hi, position: 'drops', pain: 'flare', hours: 2 });
  await mk(addDays(TODAY, -6), { intensity: hi, position: 'drops', pain: 'moderate', hours: 1.5 });
  await mk(addDays(TODAY, -8), { intensity: hi, position: 'drops', pain: 'moderate', hours: 2 });
  await mk(addDays(TODAY, -10), { intensity: hi, position: 'drops', pain: 'none', hours: 2 });
  await mk(addDays(TODAY, -12), { intensity: hi, position: 'drops', pain: 'none', hours: 1.5 });
  await mk(addDays(TODAY, -14), { intensity: hi, position: 'upright', pain: 'none', hours: 2 });
  await mk(addDays(TODAY, -16), { intensity: hi, position: 'upright', pain: 'none', hours: 2 });
  await mk(addDays(TODAY, -18), { intensity: hi, position: 'upright', pain: 'none', hours: 2 });
  await mk(addDays(TODAY, -20), { intensity: hi, position: 'upright', pain: 'none', hours: 2 });
  // Long, easy drops rides — the distance control: no pain despite being longest.
  await mk(addDays(TODAY, -22), { intensity: 0.6, position: 'drops', pain: 'none', hours: 7 });
  await mk(addDays(TODAY, -24), { intensity: 0.6, position: 'drops', pain: 'none', hours: 8 });

  const c = await backpain.painCorrelation({ asOf: TODAY, days: 60 });
  const drops = c.table.highIf.byPosition.find((r) => r.position === 'drops');
  const upright = c.table.highIf.byPosition.find((r) => r.position === 'upright');
  assert.equal(drops.rides, 6);
  assert.equal(drops.painRides, 4);
  assert.equal(upright.rides, 4);
  assert.equal(upright.painRides, 0);
  assert.match(c.headline, /4 of 6 drops rides/);
  assert.match(c.headline, /0 of 4 upright rides/);
  assert.ok(c.durationControl.enough);
  // The longer half is dominated by the easy 7-8h drops rides with no pain.
  assert.ok(c.durationControl.longer.painRatePct <= c.durationControl.shorter.painRatePct);

  const flag = await backpain.painFlag({ asOf: TODAY, days: 60 });
  assert.ok(flag, 'expected a pain flag');
  assert.equal(flag.numbers.dropsPainRatePct, 67);
});

test('sparse pain data says so instead of inventing a pattern', async () => {
  await db.exec('DELETE FROM ride_logs');
  const c = await backpain.painCorrelation({ asOf: TODAY, days: 60 });
  assert.equal(c.sufficient, false);
  assert.match(c.headline, /Not enough logged rides/);
  assert.equal(await backpain.painFlag({ asOf: TODAY, days: 60 }), null);
});

test('plan and brief work fine with no daily-log data at all', async () => {
  await db.exec('DELETE FROM daily_logs');
  const r = await planner.generatePlan(goalId, { reason: 'no-daily-logs' });
  assert.ok(r.weeks.length > 0);
  assert.ok(r.weeks.every((w) => w.target_tss > 0 && w.target_hours > 0));
  const b = await brief.buildBrief({ goalId, asOf: TODAY });
  assert.ok(b.headline.length > 0);
});

test('base-phase key sessions vary week to week rather than repeating verbatim', async () => {
  const r = await planner.generatePlan(goalId, { reason: 'variety-check' });
  const base = r.weeks.filter((w) => w.phase === 'base1' || w.phase === 'base2' || w.phase === 'base3');
  const distinctTempoOrSweetSpot = new Set(
    base.map((w) => JSON.parse(w.key_sessions_json).find((s) => s.name === 'Tempo' || s.name === 'Sweet spot')?.detail)
  );
  assert.ok(distinctTempoOrSweetSpot.size > 1, 'expected more than one distinct quality-session variant across the base phase');
});

test('TSB around -20 mid-block does not trigger a load-cutting warn, but the same TSB in taper does', async () => {
  const generated = await planner.generatePlan(goalId, { reason: 'block-aware-check' });
  await planner.savePlan(generated);
  const loadWeek = generated.weeks.find((w) => !w.is_recovery && ['base1', 'base2', 'base3'].includes(w.phase));
  const taperWeek = generated.weeks.find((w) => w.phase === 'taper');
  assert.ok(loadWeek, 'expected a non-recovery base week');
  assert.ok(taperWeek, 'expected a taper week');

  // Hold TSB flat at -20 across the 8-day lookback fitnessSeries/rampRate use,
  // so ramp is ~0 and only the tsb-low rule is in play.
  async function forceFlatTsb(asOf) {
    await db.exec('DELETE FROM wellness');
    for (let d = -8; d <= 0; d++) {
      await db.prepare('INSERT OR REPLACE INTO wellness (date, ctl, atl) VALUES (?,60,80)').run(addDays(asOf, d));
    }
  }

  await forceFlatTsb(loadWeek.start_date);
  const loadBrief = await brief.buildBrief({ goalId, asOf: loadWeek.start_date });
  assert.ok(
    !loadBrief.governing.some((g) => g.decision.includes('tsb-low')),
    'expected no tsb-low adjustment for a load week not yet at its scheduled recovery week'
  );

  await forceFlatTsb(taperWeek.start_date);
  const taperBrief = await brief.buildBrief({ goalId, asOf: taperWeek.start_date });
  assert.ok(
    taperBrief.governing.some((g) => g.decision.includes('tsb-low')),
    'expected tsb-low to still apply in taper, where freshness matters'
  );

  await db.exec('DELETE FROM wellness');
});

test('weekly run writes a brief and a new plan version', async () => {
  const versionBefore = (await planner.activePlan(goalId)).version;
  const res = await brief.runWeekly({ goalId, asOf: TODAY });
  assert.ok(res.replanned.version > versionBefore);
  assert.equal(res.brief.week_start, weekStart(TODAY));
  assert.ok(res.brief.body_md.length > 200);
  // Re-running the same week updates in place rather than duplicating.
  await brief.runWeekly({ goalId, asOf: TODAY });
  const count = await db.prepare('SELECT COUNT(*) c FROM briefs WHERE week_start = ?').get(weekStart(TODAY));
  assert.equal(count.c, 1);
});

test('intervals.icu client resolves the stored settings, not a stray Promise, when no key is passed explicitly', async () => {
  // Regression: getSetting()/setSetting() became async in the Vercel/Turso
  // migration, and server/intervals.js was missed — request() and
  // getAthleteId() read the stored API key/athlete id without awaiting,
  // so an unconfigured caller (the real "Sync" button, as opposed to
  // "test connection" which always passes an explicit key) built URLs
  // like /athlete/[object Promise]/activities and got a 401 from
  // intervals.icu for a nonsense path rather than a real auth error.
  await setSetting('intervals_api_key', 'fake-test-key');
  await setSetting('intervals_athlete_id', '0'); // force getAthleteId to resolve it itself

  const requestedUrls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    requestedUrls.push(u);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify(u.includes('/activities') ? [] : { id: 42, name: 'Test Athlete' }),
    };
  };
  try {
    const id = await intervalsClient.getAthleteId({});
    assert.equal(id, '42');
    await intervalsClient.fetchActivities({ oldest: TODAY, newest: TODAY });
  } finally {
    globalThis.fetch = realFetch;
    await setSetting('intervals_athlete_id', '0');
  }

  assert.ok(requestedUrls.length >= 2, 'expected at least the athlete lookup and one activities call');
  for (const url of requestedUrls) {
    assert.ok(!url.includes('Promise'), `URL leaked an unresolved Promise: ${url}`);
    assert.match(url, /\/athlete\/(0|42)(\/|$)/, `URL did not contain a real athlete id: ${url}`);
  }
});

test('proteinFlag: fires on a genuine shortfall, stays quiet on thin data or no shortfall', () => {
  const athlete = { weight_kg: 60 }; // target = 120 g/day
  const shortfall = { proteinN: 6, proteinMean: 95 }; // < 120 * 0.85 = 102
  const onTarget = { proteinN: 6, proteinMean: 110 };
  const thinData = { proteinN: 3, proteinMean: 80 };

  const withWeek = brief.proteinFlag(shortfall, athlete, 500);
  assert.ok(withWeek, 'expected a flag on a genuine shortfall');
  assert.equal(withWeek.severity, 'warn');
  assert.equal(withWeek.numbers.target, 120);
  assert.match(withWeek.text, /500 TSS\/wk/);

  const withoutWeek = brief.proteinFlag(shortfall, athlete);
  assert.ok(withoutWeek);
  assert.doesNotMatch(withoutWeek.text, /TSS\/wk/);

  assert.equal(brief.proteinFlag(onTarget, athlete), null, 'on-target protein should not flag');
  assert.equal(brief.proteinFlag(thinData, athlete), null, 'fewer than 5 logged days should not flag');
  assert.equal(brief.proteinFlag(shortfall, {}), null, 'no athlete weight on file should not flag');
});
