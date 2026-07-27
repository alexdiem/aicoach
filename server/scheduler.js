// Background jobs: periodic intervals.icu sync, and the Monday replan + brief.
// Deliberately a plain interval loop — this is a single-user local tool, and a
// cron dependency would buy nothing.

import { getSetting, setSetting } from './db.js';
import { syncFromIntervals } from './sync.js';
import { runWeekly } from './brief.js';
import { activeGoal } from './planner.js';
import { today, weekStart } from './util.js';

const TICK_MS = 10 * 60 * 1000; // check every 10 minutes

async function maybeSync() {
  const hours = parseFloat(getSetting('auto_sync_hours', '6'));
  if (!Number.isFinite(hours) || hours <= 0) return;
  if (!getSetting('intervals_api_key')) return;
  const last = getSetting('last_sync_at');
  if (last && Date.now() - new Date(last).getTime() < hours * 3600 * 1000) return;
  try {
    const r = await syncFromIntervals();
    console.log(`[scheduler] synced ${r.activities} activities, ${r.wellness} wellness rows`);
  } catch (e) {
    console.error('[scheduler] sync failed:', e.message);
  }
}

function maybeWeekly() {
  if (getSetting('auto_replan_enabled', '1') !== '1') return;
  const goal = activeGoal();
  if (!goal) return;
  const ws = weekStart(today());
  if (getSetting('last_weekly_run_week') === ws) return;
  try {
    const res = runWeekly({ goalId: goal.id });
    setSetting('last_weekly_run_week', ws);
    console.log(
      `[scheduler] weekly run for ${ws}: brief written${res.replanned ? `, plan v${res.replanned.version}` : ''}`
    );
  } catch (e) {
    console.error('[scheduler] weekly run failed:', e.message);
  }
}

export function startScheduler() {
  const tick = async () => {
    await maybeSync();
    maybeWeekly();
  };
  // Give the server a moment to bind before the first (network) tick.
  setTimeout(tick, 5000).unref?.();
  const h = setInterval(tick, TICK_MS);
  h.unref?.();
  return h;
}
