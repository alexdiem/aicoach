#!/usr/bin/env node
// Command line entry points, for cron or a quick terminal check.
//
//   npm run sync                    pull from intervals.icu
//   npm run replan                  regenerate the active goal's plan
//   npm run brief                   print this week's brief as markdown
//   node server/cli.js weekly       replan + write the brief (what the scheduler runs)
//   node server/cli.js key <APIKEY> store the intervals.icu API key
//   node server/cli.js seed --ftp 240 --weight 62

import { setSetting, getSetting, upsertAthlete, getAthlete } from './db.js';
import { syncFromIntervals } from './sync.js';
import { regenerate, activeGoal, activePlan, planWeeks } from './planner.js';
import { buildBrief, saveBrief, runWeekly } from './brief.js';
import { currentFitness } from './metrics.js';
import { painCorrelation } from './backpain.js';
import { today } from './util.js';

const [, , cmd, ...args] = process.argv;

function flag(name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const commands = {
  async sync() {
    const r = await syncFromIntervals({ daysBack: flag('days') ? parseInt(flag('days'), 10) : undefined });
    console.log(`Synced ${r.activities} activities and ${r.wellness} wellness rows (${r.oldest} → ${r.newest}).`);
    if (r.message) console.log(`Notes: ${r.message}`);
  },

  async key() {
    const k = args[0];
    if (!k) return console.error('usage: node server/cli.js key <APIKEY>');
    setSetting('intervals_api_key', k);
    console.log('API key stored.');
  },

  async seed() {
    const patch = {};
    if (flag('ftp')) patch.ftp = parseFloat(flag('ftp'));
    if (flag('weight')) patch.weight_kg = parseFloat(flag('weight'));
    if (flag('maxhr')) patch.max_hr = parseInt(flag('maxhr'), 10);
    if (flag('lthr')) patch.threshold_hr = parseInt(flag('lthr'), 10);
    if (flag('age')) patch.age = parseInt(flag('age'), 10);
    console.log(upsertAthlete(patch));
  },

  async replan() {
    const goal = activeGoal();
    if (!goal) return console.error('No active goal.');
    const r = regenerate(goal.id, flag('reason', 'cli'));
    console.log(`Plan v${r.version} for "${goal.name}": ${r.result.weeks.length} weeks, peak CTL ${r.result.targets.achievableCtl} (target ${r.result.targets.targetCtl}).`);
    for (const n of r.result.notes) console.log(`  • ${n.text}`);
  },

  async brief() {
    const b = buildBrief({ asOf: flag('week', today()) });
    console.log(b.body);
  },

  async weekly() {
    const res = runWeekly({ asOf: flag('week', today()) });
    console.log(res.brief.body_md);
  },

  async status() {
    const goal = activeGoal();
    const fit = currentFitness();
    console.log('athlete:', getAthlete());
    console.log('fitness:', fit);
    console.log('api key set:', !!getSetting('intervals_api_key'));
    if (goal) {
      const plan = activePlan(goal.id);
      console.log(`goal: ${goal.name} on ${goal.event_date} (plan v${plan?.version}, ${plan ? planWeeks(plan.id).length : 0} weeks)`);
    } else {
      console.log('goal: none');
    }
  },

  async backpain() {
    const c = painCorrelation({ days: parseInt(flag('days', '365'), 10) });
    console.log(c.headline);
    console.log(`\nHigh-IF rides (IF ≥ ${c.ifThreshold}):`);
    for (const row of c.table.highIf.byPosition) {
      console.log(`  ${row.position.padEnd(8)} ${row.painRides}/${row.rides} pain (${row.painRatePct ?? '—'}%), mean IF ${row.meanIf ?? '—'}, mean VI ${row.meanVi ?? '—'}`);
    }
  },
};

const fn = commands[cmd];
if (!fn) {
  console.error(`usage: node server/cli.js <${Object.keys(commands).join('|')}>`);
  process.exit(1);
}
fn().then(
  () => process.exit(0),
  (e) => {
    console.error(e.message);
    process.exit(1);
  }
);
