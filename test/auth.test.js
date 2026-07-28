// Unit tests for server/auth.js — the single-user password gate. Separate
// from pipeline.test.js since this exercises process.env toggling and cookie
// parsing rather than the training-domain pipeline.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  authEnabled,
  checkPassword,
  createSessionCookie,
  clearSessionCookie,
  isAuthenticated,
} from '../server/auth.js';

const ORIGINAL_PASSWORD = process.env.APP_PASSWORD;
const ORIGINAL_SECRET = process.env.SESSION_SECRET;
test.after(() => {
  if (ORIGINAL_PASSWORD === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = ORIGINAL_PASSWORD;
  if (ORIGINAL_SECRET === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = ORIGINAL_SECRET;
});

// Note: can't use destructured defaults here — `{ password: undefined }` would
// trigger the default rather than mean "explicitly unset", since JS applies
// default parameters whenever a value is `undefined`, not just when absent.
function configure(opts = {}) {
  const password = 'password' in opts ? opts.password : 'sekret';
  const secret = 'secret' in opts ? opts.secret : 'sign-key';
  if (password === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = password;
  if (secret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = secret;
}

function cookieValue(setCookieHeader) {
  return setCookieHeader.split(';')[0];
}

test('auth is disabled when APP_PASSWORD is unset, and every request passes', () => {
  configure({ password: undefined });
  assert.equal(authEnabled(), false);
  assert.equal(isAuthenticated({ headers: {} }), true);
});

test('auth stays disabled when APP_PASSWORD is set but SESSION_SECRET is not', () => {
  configure({ password: 'sekret', secret: undefined });
  assert.equal(authEnabled(), false);
  assert.equal(isAuthenticated({ headers: {} }), true);
});

test('checkPassword: correct password matches, wrong and empty do not', () => {
  configure({ password: 'correct-horse-battery-staple' });
  assert.equal(checkPassword('correct-horse-battery-staple'), true);
  assert.equal(checkPassword('wrong'), false);
  assert.equal(checkPassword(''), false);
  assert.equal(checkPassword(undefined), false);
});

test('isAuthenticated: bearer token with the right password authenticates', () => {
  configure();
  assert.equal(isAuthenticated({ headers: { authorization: 'Bearer sekret' } }), true);
  assert.equal(isAuthenticated({ headers: { authorization: 'Bearer nope' } }), false);
  assert.equal(isAuthenticated({ headers: {} }), false);
});

test('isAuthenticated: a session cookie minted by createSessionCookie is accepted', () => {
  configure();
  const cookie = cookieValue(createSessionCookie());
  assert.equal(isAuthenticated({ headers: { cookie } }), true);
});

test('isAuthenticated: a tampered or foreign cookie is rejected', () => {
  configure();
  const cookie = cookieValue(createSessionCookie());
  const tampered = cookie.slice(0, -1) + (cookie.endsWith('0') ? '1' : '0');
  assert.equal(isAuthenticated({ headers: { cookie: tampered } }), false);
  assert.equal(isAuthenticated({ headers: { cookie: 'aicoach_session=garbage' } }), false);
});

test('isAuthenticated: rotating APP_PASSWORD alone does not invalidate outstanding cookies, by design — only SESSION_SECRET signs them', () => {
  configure({ password: 'sekret' });
  const cookie = cookieValue(createSessionCookie());
  configure({ password: 'a-new-password' });
  assert.equal(isAuthenticated({ headers: { cookie } }), true);
  // The old password no longer works for a fresh login, though.
  assert.equal(checkPassword('sekret'), false);
});

test('isAuthenticated: rotating SESSION_SECRET alone invalidates outstanding cookies without touching the password', () => {
  configure({ password: 'sekret', secret: 'old-secret' });
  const cookie = cookieValue(createSessionCookie());
  assert.equal(isAuthenticated({ headers: { cookie } }), true);
  configure({ password: 'sekret', secret: 'rotated-secret' });
  assert.equal(isAuthenticated({ headers: { cookie } }), false);
  // The password itself still works for a fresh login.
  assert.equal(checkPassword('sekret'), true);
});

test('clearSessionCookie expires immediately and no longer authenticates', () => {
  configure();
  const cleared = cookieValue(clearSessionCookie());
  assert.match(clearSessionCookie(), /Max-Age=0/);
  assert.equal(isAuthenticated({ headers: { cookie: cleared } }), false);
});
