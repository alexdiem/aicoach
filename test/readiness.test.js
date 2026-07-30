// Daily readiness check (server/readiness.js): HRV, resting HR, and sleep
// against the athlete's own recent baseline, using synced wellness rows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aicoach-readiness-test-'));
process.env.AICOACH_DB = join(dir, 'test.db');

const { db } = await import('../server/db.js');
const { addDays, today } = await import('../server/util.js');
const { dailyReadiness } = await import('../server/readiness.js');

process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

const TODAY = today();

async function seedWellness(date, fields = {}) {
  const cols = ['date', ...Object.keys(fields)];
  const placeholders = cols.map(() => '?').join(',');
  await db
    .prepare(`INSERT OR REPLACE INTO wellness (${cols.join(',')}) VALUES (${placeholders})`)
    .run(date, ...Object.values(fields));
}

test('no wellness data at all: hasData is false, no flags', async () => {
  const r = await dailyReadiness(addDays(TODAY, -900));
  assert.equal(r.hasData, false);
  assert.equal(r.headline, null);
  assert.deepEqual(r.flags, []);
});

test('a wellness row more than 2 days stale is treated as no data, not shown as "today"', async () => {
  const asOf = addDays(TODAY, -800);
  await seedWellness(addDays(asOf, -5), { hrv: 60 });
  const r = await dailyReadiness(asOf);
  assert.equal(r.hasData, false);
});

test('HRV well below baseline flags a warn (or critical if the drop is large); well above flags good', async () => {
  const asOf = addDays(TODAY, -700);
  for (let i = 21; i >= 1; i--) await seedWellness(addDays(asOf, -i), { hrv: 60 });
  await seedWellness(asOf, { hrv: 48 }); // -20%
  const low = await dailyReadiness(asOf);
  const hrvLow = low.flags.find((f) => f.id === 'hrv-low');
  assert.ok(hrvLow, 'expected an hrv-low flag');
  assert.equal(hrvLow.severity, 'warn');

  const asOf2 = addDays(TODAY, -650);
  for (let i = 21; i >= 1; i--) await seedWellness(addDays(asOf2, -i), { hrv: 60 });
  await seedWellness(asOf2, { hrv: 45 }); // -25%, over the critical line
  const critical = await dailyReadiness(asOf2);
  assert.equal(critical.flags.find((f) => f.id === 'hrv-low').severity, 'critical');

  const asOf3 = addDays(TODAY, -600);
  for (let i = 21; i >= 1; i--) await seedWellness(addDays(asOf3, -i), { hrv: 60 });
  await seedWellness(asOf3, { hrv: 72 }); // +20%
  const high = await dailyReadiness(asOf3);
  const hrvHigh = high.flags.find((f) => f.id === 'hrv-high');
  assert.ok(hrvHigh, 'expected an hrv-high (good) flag');
  assert.equal(hrvHigh.severity, 'good');
});

test('HRV within +/-15% of baseline does not flag', async () => {
  const asOf = addDays(TODAY, -550);
  for (let i = 21; i >= 1; i--) await seedWellness(addDays(asOf, -i), { hrv: 60 });
  await seedWellness(asOf, { hrv: 63 }); // +5%
  const r = await dailyReadiness(asOf);
  assert.ok(!r.flags.some((f) => f.id.startsWith('hrv')));
});

test('elevated resting HR vs baseline flags a warn', async () => {
  const asOf = addDays(TODAY, -500);
  for (let i = 21; i >= 1; i--) await seedWellness(addDays(asOf, -i), { resting_hr: 48 });
  await seedWellness(asOf, { resting_hr: 57 }); // +9
  const r = await dailyReadiness(asOf);
  const flag = r.flags.find((f) => f.id === 'rhr-elevated');
  assert.ok(flag);
  assert.equal(flag.severity, 'warn');
});

test('short sleep flags a warn below 5h, info between 5h and 6h', async () => {
  const asOf = addDays(TODAY, -450);
  await seedWellness(asOf, { sleep_secs: 4.5 * 3600 });
  const r = await dailyReadiness(asOf);
  const flag = r.flags.find((f) => f.id === 'sleep-short');
  assert.ok(flag);
  assert.equal(flag.severity, 'warn');

  const asOf2 = addDays(TODAY, -449);
  await seedWellness(asOf2, { sleep_secs: 5.5 * 3600 });
  const r2 = await dailyReadiness(asOf2);
  assert.equal(r2.flags.find((f) => f.id === 'sleep-short').severity, 'info');
});

test('subjective fields (soreness/fatigue/stress/mood/motivation/injury/readiness) are returned raw, never flagged', async () => {
  const asOf = addDays(TODAY, -400);
  await seedWellness(asOf, { soreness: 3, fatigue: 4, stress: 2, mood: 1, motivation: 2, injury: 1, readiness: 70 });
  const r = await dailyReadiness(asOf);
  assert.deepEqual(r.subjective, { soreness: 3, fatigue: 4, stress: 2, mood: 1, motivation: 2, injury: 1, readiness: 70 });
  // No flag id should ever be derived from these fields.
  const subjectiveFlagIds = ['soreness', 'fatigue', 'stress', 'mood', 'motivation', 'injury', 'readiness'];
  assert.ok(!r.flags.some((f) => subjectiveFlagIds.includes(f.id)));
});

test('headline: worst flag wins over good, and a quiet day names the numbers', async () => {
  const asOf = addDays(TODAY, -350);
  await seedWellness(asOf, { hrv: 60, resting_hr: 48, sleep_secs: 7.5 * 3600 });
  const quiet = await dailyReadiness(asOf);
  assert.match(quiet.headline, /HRV 60/);
  assert.match(quiet.headline, /nothing to flag/i);

  const asOf2 = addDays(TODAY, -300);
  for (let i = 21; i >= 1; i--) await seedWellness(addDays(asOf2, -i), { hrv: 60, resting_hr: 48 });
  await seedWellness(asOf2, { hrv: 42, resting_hr: 57 }); // both hrv-critical and rhr-elevated
  const bad = await dailyReadiness(asOf2);
  assert.equal(bad.headline, bad.flags[0].title);
  assert.equal(bad.flags[0].severity, 'critical');
});
