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
import { serveStatic } from '../server/staticFiles.js';
import { isAuthenticated } from '../server/auth.js';

export const config = { runtime: 'nodejs' };

// Everything under /public is normally served by Vercel's static layer
// directly (see the "handle: filesystem" step in vercel.json), bypassing this
// function entirely — fine for styles.css, but it means the app shell
// (index.html, app.js) would otherwise be reachable with no auth check at
// all. vercel.json routes just those three paths through this function
// instead so the same session check that guards /api/* also covers them;
// everything else (styles.css, the favicon) stays on the plain static path.
const SHELL_PATHS = new Set(['/', '/index.html', '/app.js']);

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    await handleApiRequest(req, res, { pathname, searchParams: url.searchParams });
    return;
  }

  if (SHELL_PATHS.has(pathname)) {
    if (!isAuthenticated(req)) {
      res.writeHead(302, { Location: '/login.html' });
      res.end();
      return;
    }
    await serveStatic(req, res, pathname);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
}
