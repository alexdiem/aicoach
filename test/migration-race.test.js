// Vercel serverless instances share no memory, so on a fresh deploy several
// cold starts can run the schema migration concurrently against the same
// Turso database (see server/db.js's migrate()). Two instances can both see
// a column present via PRAGMA table_info and both attempt to add/drop it —
// the first wins, the second's ALTER TABLE fails purely because its sibling
// already made the same idempotent change a moment earlier. ensureColumn and
// dropColumnIfExists must treat that as success, not propagate it.
//
// This exercises the race with a fake driver rather than real concurrency:
// PRAGMA reporting the column present (a stale-but-plausible view) while the
// ALTER TABLE itself fails as if a concurrent sibling already applied it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aicoach-migration-race-test-'));
process.env.AICOACH_DB = join(dir, 'test.db');

const { ensureColumn, dropColumnIfExists } = await import('../server/db.js');

process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

function fakeDriver({ columnPresent, execError }) {
  return {
    async all() {
      return columnPresent ? [{ name: 'target_col' }] : [];
    },
    async execRaw() {
      if (execError) throw new Error(execError);
    },
  };
}

test('ensureColumn swallows "duplicate column name" — a concurrent instance already added it', async () => {
  const d = fakeDriver({ columnPresent: false, execError: 'SQLite error: duplicate column name: target_col' });
  await assert.doesNotReject(ensureColumn(d, 'sometable', 'target_col', 'TEXT'));
});

test('ensureColumn still throws on an unrelated ALTER TABLE failure', async () => {
  const d = fakeDriver({ columnPresent: false, execError: 'SQLite error: disk I/O error' });
  await assert.rejects(ensureColumn(d, 'sometable', 'target_col', 'TEXT'), /disk I\/O error/);
});

test('ensureColumn does nothing (no ALTER attempted) when the column is already there', async () => {
  let execCalled = false;
  const d = {
    async all() { return [{ name: 'target_col' }]; },
    async execRaw() { execCalled = true; },
  };
  await ensureColumn(d, 'sometable', 'target_col', 'TEXT');
  assert.equal(execCalled, false);
});

test('dropColumnIfExists swallows "no such column" — a concurrent instance already dropped it', async () => {
  const d = fakeDriver({ columnPresent: true, execError: 'SQLite input error: no such column: "target_col" (at offset 33)' });
  await assert.doesNotReject(dropColumnIfExists(d, 'sometable', 'target_col'));
});

test('dropColumnIfExists still throws on an unrelated ALTER TABLE failure', async () => {
  const d = fakeDriver({ columnPresent: true, execError: 'SQLite error: database is locked' });
  await assert.rejects(dropColumnIfExists(d, 'sometable', 'target_col'), /database is locked/);
});

test('dropColumnIfExists does nothing (no ALTER attempted) when the column is already gone', async () => {
  let execCalled = false;
  const d = {
    async all() { return []; },
    async execRaw() { execCalled = true; },
  };
  await dropColumnIfExists(d, 'sometable', 'target_col');
  assert.equal(execCalled, false);
});
