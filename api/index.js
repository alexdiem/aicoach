// Vercel serverless entrypoint. A single, plainly-named function — Vercel's
// bracket-based dynamic route file (`api/[...slug].js`) turned out not to
// behave as a true catch-all in practice (single path segments under /api/
// resolved fine; two or more 404'd at the platform level before ever
// reaching this code). vercel.json now rewrites every /api/* request here
// via a plain regex rule instead, which is a much simpler, more predictable
// mechanism than relying on filesystem dynamic-segment conventions.
//
// Static files (index.html, app.js, styles.css) are served directly by Vercel
// from /public; this function only ever sees /api/* requests. It also
// handles /api/cron directly (dispatching on pathname) rather than as a
// separate file, so there's only one routing mechanism to reason about.

import { handleApiRequest, sendJson } from '../server/requestHandler.js';
import { runScheduledJobs } from '../server/scheduler.js';

export const config = { runtime: 'nodejs' };

async function handleCron(req, res) {
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

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/cron') {
    return handleCron(req, res);
  }
  await handleApiRequest(req, res, { pathname: url.pathname, searchParams: url.searchParams });
}
