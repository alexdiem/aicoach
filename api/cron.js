// Vercel Cron target. Runs the same sync + weekly-replan check the local
// server's setInterval loop runs (see server/scheduler.js) — serverless
// functions can't run a persistent background loop, so Vercel's scheduler
// calls this endpoint on the cadence set in vercel.json instead.
//
// Protected by CRON_SECRET: set that env var and Vercel automatically sends
// `Authorization: Bearer <CRON_SECRET>` when it invokes this on schedule
// (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
// Without it configured, the endpoint still runs (this only ever triggers a
// sync + replan, not anything destructive) but a warning is logged.

import { runScheduledJobs } from '../server/scheduler.js';
import { sendJson } from '../server/requestHandler.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.authorization !== `Bearer ${secret}`) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }
  } else {
    console.warn('[cron] CRON_SECRET not set — /api/cron is unauthenticated. See README.');
  }

  try {
    const result = await runScheduledJobs();
    sendJson(res, 200, { ok: true, ...result });
  } catch (e) {
    console.error('[cron] failed:', e.message);
    sendJson(res, 500, { ok: false, error: e.message });
  }
}
