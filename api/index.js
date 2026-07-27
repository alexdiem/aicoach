// Vercel serverless entrypoint — the ONLY function this deployment defines
// for the whole API surface (plus api/cron.js), by necessity: Vercel's Hobby
// plan caps a deployment at 12 Serverless Functions, so one function per
// route (tried once) is not an option here regardless of how well it routes.
//
// vercel.json forces every /api/* request through this file via the legacy
// `routes` config (not `rewrites` — see vercel.json's comment-equivalent
// note for why). The actual method+path routing logic lives entirely in
// server/api.js's route table via matchRoute; this file just adapts the
// Vercel request/response shape to that shared dispatcher.
//
// Static files (index.html, app.js, styles.css) are served directly by
// Vercel from /public; this function only ever sees /api/* requests.

import { handleApiRequest } from '../server/requestHandler.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  await handleApiRequest(req, res, { pathname: url.pathname, searchParams: url.searchParams });
}
