// Shared request handling for the JSON API — used by both the local Node
// http server (server/index.js) and the Vercel serverless function
// (api/index.js). Vercel's Node.js runtime hands functions a request/response
// pair that behaves like Node's http.IncomingMessage/ServerResponse, so the
// same code works in both places.

import { matchRoute } from './api.js';
import { isAuthenticated } from './auth.js';

const PUBLIC_ROUTES = new Set(['POST /api/login']);

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload ?? null);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readBody(req) {
  // Some Node.js-runtime hosts (Vercel included, depending on version) parse
  // JSON bodies onto req.body already; only fall back to reading the stream
  // when that hasn't happened.
  if (req.body !== undefined && req.body !== null) {
    return typeof req.body === 'string' ? (req.body ? JSON.parse(req.body) : null) : req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 2 * 1024 * 1024) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return null;
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('invalid JSON body'), { status: 400 });
  }
}

/** Handle one /api/* request against the shared route table. */
export async function handleApiRequest(req, res, { pathname, searchParams }) {
  const route = matchRoute(req.method, pathname);
  if (!route) return sendJson(res, 404, { error: `No route for ${req.method} ${pathname}` });

  if (!PUBLIC_ROUTES.has(`${req.method} ${pathname}`) && !isAuthenticated(req)) {
    return sendJson(res, 401, { error: 'unauthorized' });
  }

  try {
    const body = req.method === 'GET' || req.method === 'DELETE' ? null : await readBody(req);
    const query = Object.fromEntries(searchParams.entries());
    const out = await route.handler({ body, query, params: route.params, req, res });
    sendJson(res, 200, out);
  } catch (err) {
    const status = err.status || (err.name === 'IntervalsError' ? err.status || 502 : 500);
    if (!err.status) console.error(`[api] ${req.method} ${pathname}:`, err);
    sendJson(res, status >= 400 && status < 600 ? status : 500, {
      error: err.message,
      detail: err.body || undefined,
    });
  }
}
