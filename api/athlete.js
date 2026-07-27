// Thin dispatcher — Vercel resolves this file purely because it exists at
// this exact path (see api/README-ROUTING.md for why: catch-all/rewrite-based
// routing did not behave as documented in this project's deployment, so every
// path the frontend calls now has a real, literal file). The actual method+path
// routing logic lives entirely in server/api.js's route table via matchRoute,
// unchanged regardless of which literal file Vercel invoked to get here.

import { handleApiRequest } from '../server/requestHandler.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  await handleApiRequest(req, res, { pathname: url.pathname, searchParams: url.searchParams });
}
