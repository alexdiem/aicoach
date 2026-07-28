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

const ORIGINAL = process.env.AICOACH_PASSWORD;
test.after(() => {
  if (ORIGINAL === undefined) delete process.env.AICOACH_PASSWORD;
  else process.env.AICOACH_PASSWORD = ORIGINAL;
});

function cookieValue(setCookieHeader) {
  return setCookieHeader.split(';')[0];
}

test('auth is disabled when AICOACH_PASSWORD is unset, and every request passes', () => {
  delete process.env.AICOACH_PASSWORD;
  assert.equal(authEnabled(), false);
  assert.equal(isAuthenticated({ headers: {} }), true);
});

test('checkPassword: correct password matches, wrong and empty do not', () => {
  process.env.AICOACH_PASSWORD = 'correct-horse-battery-staple';
  assert.equal(checkPassword('correct-horse-battery-staple'), true);
  assert.equal(checkPassword('wrong'), false);
  assert.equal(checkPassword(''), false);
  assert.equal(checkPassword(undefined), false);
});

test('isAuthenticated: bearer token with the right password authenticates', () => {
  process.env.AICOACH_PASSWORD = 'sekret';
  assert.equal(isAuthenticated({ headers: { authorization: 'Bearer sekret' } }), true);
  assert.equal(isAuthenticated({ headers: { authorization: 'Bearer nope' } }), false);
  assert.equal(isAuthenticated({ headers: {} }), false);
});

test('isAuthenticated: a session cookie minted by createSessionCookie is accepted', () => {
  process.env.AICOACH_PASSWORD = 'sekret';
  const cookie = cookieValue(createSessionCookie());
  assert.equal(isAuthenticated({ headers: { cookie } }), true);
});

test('isAuthenticated: a tampered or foreign cookie is rejected', () => {
  process.env.AICOACH_PASSWORD = 'sekret';
  const cookie = cookieValue(createSessionCookie());
  const tampered = cookie.slice(0, -1) + (cookie.endsWith('0') ? '1' : '0');
  assert.equal(isAuthenticated({ headers: { cookie: tampered } }), false);
  assert.equal(isAuthenticated({ headers: { cookie: 'aicoach_session=garbage' } }), false);
});

test('isAuthenticated: a cookie minted under a different password is rejected once the password changes', () => {
  process.env.AICOACH_PASSWORD = 'sekret';
  const cookie = cookieValue(createSessionCookie());
  process.env.AICOACH_PASSWORD = 'a-new-password';
  assert.equal(isAuthenticated({ headers: { cookie } }), false);
});

test('clearSessionCookie expires immediately and no longer authenticates', () => {
  process.env.AICOACH_PASSWORD = 'sekret';
  const cleared = cookieValue(clearSessionCookie());
  assert.match(clearSessionCookie(), /Max-Age=0/);
  assert.equal(isAuthenticated({ headers: { cookie: cleared } }), false);
});
