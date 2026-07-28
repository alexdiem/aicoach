// Background jobs: periodic intervals.icu sync, and the Monday replan + brief.
//
// Two run modes share this logic:
//   - `npm start` (local, long-running process): a plain setInterval loop —
//     this is a single-user local tool, and a cron dependency would buy
//     nothing here.
//   - Vercel: serverless functions don't persist between invocations, so
//     setInterval is meaningless there. Vercel Cron instead hits /api/cron on
//     a schedule, which calls runScheduledJobs() once per invocation — see
//     api/cron.js.

import { getSetting, setSetting, recordJobFailure, clearJobFailures } from './db.js';
import { syncFromIntervals } from './sync.js';
import { runWeekly } from './brief.js';
import { activeGoal } from './planner.js';
import { today, weekStart } from './util.js';

const TICK_MS = 10 * 60 * 1000; // check every 10 minutes

async function maybeSync() {
  const hours = parseFloat(await getSetting('auto_sync_hours', '6'));
  if (!Number.isFinite(hours) || hours <= 0) return null;
  if (!(await getSetting('intervals_api_key'))) return null;
  const last = await getSetting('last_sync_at');
  if (last && Date.now() - new Date(last).getTime() < hours * 3600 * 1000) return null;
  try {
    const r = await syncFromIntervals();
    await clearJobFailures('sync');
    console.log(`[scheduler] synced ${r.activities} activities, ${r.wellness} wellness rows`);
    return r;
  } catch (e) {
    console.error('[scheduler] sync failed:', e.message);
    await recordJobFailure('sync', e.message).catch(() => {});
    return null;
  }
}

async function maybeWeekly() {
  if ((await getSetting('auto_replan_enabled', '1')) !== '1') return null;
  const goal = await activeGoal();
  if (!goal) return null;
  const ws = weekStart(today());
  if ((await getSetting('last_weekly_run_week')) === ws) return null;
  try {
    const res = await runWeekly({ goalId: goal.id });
    await setSetting('last_weekly_run_week', ws);
    await clearJobFailures('weekly');
    console.log(
      `[scheduler] weekly run for ${ws}: brief written${res.replanned ? `, plan v${res.replanned.version}` : ''}`
    );
    return res;
  } catch (e) {
    console.error('[scheduler] weekly run failed:', e.message);
    await recordJobFailure('weekly', e.message).catch(() => {});
    return null;
  }
}

/** Run both checks once. Used by both the local interval loop and the Vercel cron endpoint. */
export async function runScheduledJobs() {
  const sync = await maybeSync();
  const weekly = await maybeWeekly();
  return { sync, weekly };
}

export function startScheduler() {
  const tick = () => {
    runScheduledJobs().catch((e) => console.error('[scheduler] tick failed:', e.message));
  };
  // Give the server a moment to bind before the first (network) tick.
  setTimeout(tick, 5000).unref?.();
  const h = setInterval(tick, TICK_MS);
  h.unref?.();
  return h;
}
