// Single-user password gate. This is a personal, single-user app reachable at
// a public URL with no auth otherwise (it stores cycle data, back pain logs,
// and a settable intervals.icu API key) — so the bar here is "keep strangers
// with the URL out", not multi-tenant identity.
//
// Session is a signed, stateless cookie (HMAC-SHA256 over an expiry, keyed by
// the password itself) rather than a server-side session store: Vercel's
// serverless functions don't share memory or persist between invocations, so
// an in-memory session table would silently stop working there. A bearer
// token (`Authorization: Bearer <password>`) is also accepted, for scripted
// access (e.g. `curl`).
//
// Auth is only enforced when AICOACH_PASSWORD is set — matching the existing
// CRON_SECRET convention in api/cron.js: unset means "not configured yet",
// not "locked out".

import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'aicoach_session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function secret() {
  return process.env.AICOACH_PASSWORD || null;
}

export function authEnabled() {
  return !!secret();
}

function sign(payload) {
  return createHmac('sha256', secret()).update(payload).digest('hex');
}

export function checkPassword(candidate) {
  const s = secret();
  if (!s || !candidate) return false;
  const a = Buffer.from(String(candidate));
  const b = Buffer.from(s);
  // timingSafeEqual throws on a length mismatch, so pad rather than short-circuit compare.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createSessionCookie() {
  const exp = Date.now() + SESSION_MAX_AGE_MS;
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  const token = `${payload}.${sign(payload)}`;
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`,
    'SameSite=Lax',
  ];
  if (process.env.VERCEL) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function validSessionToken(token) {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || sign(payload) !== sig) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

/** True if the request carries a valid session cookie or bearer token. Always
 * true when AICOACH_PASSWORD isn't set (auth disabled). */
export function isAuthenticated(req) {
  if (!authEnabled()) return true;
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ') && checkPassword(authHeader.slice(7))) return true;
  const cookies = parseCookies(req.headers['cookie']);
  return validSessionToken(cookies[COOKIE_NAME]);
}
