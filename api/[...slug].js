// Vercel serverless entrypoint. A catch-all under /api so the existing route
// table in server/api.js (matchRoute) is the single source of truth for both
// the local server (server/index.js) and this deployment — no routes are
// duplicated or re-declared here.
//
// Static files (index.html, app.js, styles.css) are served directly by Vercel
// from /public; this function only ever sees /api/* requests.

import { handleApiRequest } from '../server/requestHandler.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  await handleApiRequest(req, res, { pathname: url.pathname, searchParams: url.searchParams });
}
