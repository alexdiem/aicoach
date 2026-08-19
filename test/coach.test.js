// "Ask your coach" chat (server/coach.js): message validation and the
// Anthropic call, mocked at the fetch boundary so these run offline and never
// touch a real API key or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aicoach-coach-test-'));
process.env.AICOACH_DB = join(dir, 'test.db');

const { setSetting } = await import('../server/db.js');
const { askCoach, validateMessages, CoachError } = await import('../server/coach.js');

process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

const realFetch = globalThis.fetch;
function mockFetch(fn) {
  globalThis.fetch = fn;
}
function restoreFetch() {
  globalThis.fetch = realFetch;
}

function anthropicOk(text, model = 'claude-sonnet-5') {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }], model }), { status: 200 });
}

test('validateMessages rejects an empty conversation', () => {
  assert.throws(() => validateMessages([]), (e) => e instanceof CoachError && e.status === 400);
  assert.throws(() => validateMessages(null), (e) => e instanceof CoachError && e.status === 400);
});

test('validateMessages requires the conversation to end on a user turn', () => {
  assert.throws(
    () => validateMessages([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }]),
    (e) => e instanceof CoachError && e.status === 400
  );
});

test('validateMessages rejects malformed or oversized entries', () => {
  assert.throws(() => validateMessages([{ role: 'user', content: '' }]), CoachError);
  assert.throws(() => validateMessages([{ role: 'system', content: 'x' }]), CoachError);
  assert.throws(() => validateMessages([{ role: 'user' }]), CoachError);
  assert.throws(() => validateMessages([{ role: 'user', content: 'x'.repeat(5000) }]), CoachError);
});

test('validateMessages trims to the defensive history cap, still ending on the newest user turn', () => {
  const long = [];
  for (let i = 0; i < 20; i++) {
    long.push({ role: 'user', content: `q${i}` });
    long.push({ role: 'assistant', content: `a${i}` });
  }
  long.push({ role: 'user', content: 'final question' });
  const out = validateMessages(long);
  assert.ok(out.length < long.length, 'expected the history to be capped');
  assert.equal(out[out.length - 1].content, 'final question');
  assert.equal(out[out.length - 1].role, 'user');
});

test('askCoach refuses to run without an Anthropic key configured, and never calls the network', async () => {
  await setSetting('anthropic_api_key', '');
  let called = false;
  mockFetch(async () => { called = true; return anthropicOk('should not happen'); });
  try {
    await assert.rejects(
      askCoach([{ role: 'user', content: 'how is this week going?' }]),
      // Deliberately NOT 401 — the frontend's api() helper treats any 401
      // response as an expired session and hard-redirects to the login page,
      // which would wipe the in-progress question. 400 (a config problem the
      // athlete fixes in Settings) reaches the UI as a normal inline error.
      (e) => e instanceof CoachError && e.status === 400 && /Settings/.test(e.message)
    );
    assert.equal(called, false, 'askCoach should fail fast on a missing key, before touching the network');
  } finally {
    restoreFetch();
  }
});

test('askCoach sends the conversation plus a grounded system prompt, and returns the reply text', async () => {
  await setSetting('anthropic_api_key', 'test-key-123');
  await setSetting('coach_model', 'claude-sonnet-5');
  let seen;
  mockFetch(async (url, init) => {
    seen = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
    return anthropicOk('Ramp is 2 over the 6 CTL/wk base cap — hold this week at maintenance.');
  });
  try {
    const messages = [{ role: 'user', content: 'should I add another interval session this week?' }];
    const res = await askCoach(messages);

    assert.equal(res.text, 'Ramp is 2 over the 6 CTL/wk base cap — hold this week at maintenance.');
    assert.equal(res.model, 'claude-sonnet-5');

    assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(seen.headers['x-api-key'], 'test-key-123');
    assert.ok(seen.headers['anthropic-version']);
    assert.equal(seen.body.model, 'claude-sonnet-5');
    assert.deepEqual(seen.body.messages, messages);
    // Current-gen models think by default with no `thinking` param sent, and
    // those tokens draw from max_tokens — too low a budget here means a
    // truncated or empty reply with nothing left over for visible text.
    assert.ok(seen.body.max_tokens >= 4096, `max_tokens was ${seen.body.max_tokens}, too low to leave room for both thinking and an answer`);

    // The system prompt carries the house rule and a labelled, parseable
    // data block — not just loose prose the model has to infer structure from.
    assert.match(seen.body.system, /names the number that drove it/);
    assert.match(seen.body.system, /## DATA \(ground truth, as of/);
    const jsonBlock = seen.body.system.match(/```json\n([\s\S]*?)\n```/);
    assert.ok(jsonBlock, 'expected a fenced JSON data block in the system prompt');
    const data = JSON.parse(jsonBlock[1]);
    assert.ok('today' in data && 'athlete' in data && 'goal' in data, 'expected the coaching snapshot shape');
  } finally {
    restoreFetch();
  }
});

test('askCoach turns a 401 from Anthropic into a clear, actionable error — without passing the 401 itself to the browser', async () => {
  await setSetting('anthropic_api_key', 'bad-key');
  mockFetch(async () => new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 }));
  try {
    await assert.rejects(
      askCoach([{ role: 'user', content: 'hi' }]),
      (e) => e instanceof CoachError && e.status === 400 && /API key/.test(e.message)
    );
  } finally {
    restoreFetch();
  }
});

test('askCoach surfaces rate limiting distinctly from other failures', async () => {
  await setSetting('anthropic_api_key', 'test-key-123');
  mockFetch(async () => new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 }));
  try {
    await assert.rejects(
      askCoach([{ role: 'user', content: 'hi' }]),
      (e) => e instanceof CoachError && e.status === 429
    );
  } finally {
    restoreFetch();
  }
});

test('askCoach wraps a network failure rather than letting it throw raw', async () => {
  await setSetting('anthropic_api_key', 'test-key-123');
  mockFetch(async () => { throw new Error('getaddrinfo ENOTFOUND'); });
  try {
    await assert.rejects(
      askCoach([{ role: 'user', content: 'hi' }]),
      (e) => e instanceof CoachError && /Network error/.test(e.message)
    );
  } finally {
    restoreFetch();
  }
});

test('askCoach treats an empty reply as an error rather than returning nothing', async () => {
  await setSetting('anthropic_api_key', 'test-key-123');
  mockFetch(async () => anthropicOk(''));
  try {
    await assert.rejects(askCoach([{ role: 'user', content: 'hi' }]), CoachError);
  } finally {
    restoreFetch();
  }
});

// Regression coverage for the exact failure reported in the field: a reply
// that just stops mid-sentence, or comes back empty — both traced to
// thinking (on by default on current models, drawn from the same max_tokens
// budget) leaving little or nothing for the visible answer.
test('askCoach logs a diagnosable warning when the model hits max_tokens, rather than returning the cut-off text silently', async () => {
  await setSetting('anthropic_api_key', 'test-key-123');
  mockFetch(async () =>
    new Response(
      JSON.stringify({
        content: [{ type: 'text', text: 'The 5.2h this week isn\'t a mislabeled recovery week — it\'s the plan respecting the ramp cap after two disrupted weeks, and the "8' }],
        model: 'claude-sonnet-5',
        stop_reason: 'max_tokens',
      }),
      { status: 200 }
    )
  );
  const realWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const res = await askCoach([{ role: 'user', content: 'why is this week so short?' }]);
    assert.ok(res.text.startsWith('The 5.2h this week'), 'the (truncated) text should still be returned, not swallowed');
    assert.ok(warnings.some((w) => w.includes('max_tokens')), 'expected a diagnosable warning logged for a max_tokens cutoff');
  } finally {
    console.warn = realWarn;
    restoreFetch();
  }
});

test('askCoach warns on an empty reply caused by max_tokens too, before raising the error', async () => {
  await setSetting('anthropic_api_key', 'test-key-123');
  mockFetch(async () =>
    new Response(JSON.stringify({ content: [], model: 'claude-sonnet-5', stop_reason: 'max_tokens' }), { status: 200 })
  );
  const realWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    await assert.rejects(askCoach([{ role: 'user', content: 'hi' }]), CoachError);
    assert.ok(warnings.some((w) => w.includes('max_tokens') && w.includes('empty')), 'expected the warning to call out that the reply came back empty');
  } finally {
    console.warn = realWarn;
    restoreFetch();
  }
});
