// Exercises the Turso/libsql driver path in server/dbdriver.js. Every other
// test in this suite runs against the local node:sqlite driver only (see
// pipeline.test.js), so the code that actually serves the Vercel/production
// deployment — tursoDriver() and its transaction wrapper — has otherwise had
// zero coverage.
//
// @libsql/client supports a local `file:` URL that runs the same libSQL
// engine Turso uses in production without any network access, so this exercises
// the real driver code (createClient, execute(), transaction()) rather than a mock.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDriver, runScript, splitStatements } from '../server/dbdriver.js';

const dir = mkdtempSync(join(tmpdir(), 'aicoach-turso-test-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

async function freshDriver(name) {
  const driver = await createDriver({ tursoUrl: `file:${join(dir, name)}` });
  assert.equal(driver.kind, 'turso');
  await driver.execRaw('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, n INTEGER)');
  return driver;
}

test('splitStatements strips comments and splits on semicolons', () => {
  const stmts = splitStatements(`
    -- a comment
    CREATE TABLE a (id INTEGER); -- trailing comment
    CREATE TABLE b (id INTEGER);
  `);
  assert.deepEqual(stmts, ['CREATE TABLE a (id INTEGER)', 'CREATE TABLE b (id INTEGER)']);
});

test('turso driver: run() inserts and reports lastInsertRowid/changes', async () => {
  const d = await freshDriver('run.db');
  const r1 = await d.run('INSERT INTO t (name, n) VALUES (?, ?)', ['alice', 1]);
  assert.equal(r1.lastInsertRowid, 1);
  assert.equal(r1.changes, 1);
  const r2 = await d.run('INSERT INTO t (name, n) VALUES (?, ?)', ['bob', 2]);
  assert.equal(r2.lastInsertRowid, 2);

  const upd = await d.run('UPDATE t SET n = n + 10 WHERE name = ?', ['alice']);
  assert.equal(upd.changes, 1);
});

test('turso driver: get() returns one row or undefined', async () => {
  const d = await freshDriver('get.db');
  await d.run('INSERT INTO t (name, n) VALUES (?, ?)', ['alice', 1]);
  const row = await d.get('SELECT * FROM t WHERE name = ?', ['alice']);
  assert.equal(row.name, 'alice');
  assert.equal(row.n, 1);
  assert.equal(await d.get('SELECT * FROM t WHERE name = ?', ['nobody']), undefined);
});

test('turso driver: get()/all()/run() accept a named-params object, not just positional args', async () => {
  const d = await freshDriver('named.db');
  await d.run('INSERT INTO t (name, n) VALUES (@name, @n)', { name: 'carol', n: 3 });
  const row = await d.get('SELECT * FROM t WHERE name = @name', { name: 'carol' });
  assert.equal(row.n, 3);
});

test('turso driver: all() returns every matching row', async () => {
  const d = await freshDriver('all.db');
  for (const name of ['a', 'b', 'c']) await d.run('INSERT INTO t (name, n) VALUES (?, ?)', [name, 1]);
  const rows = await d.all('SELECT * FROM t ORDER BY name', []);
  assert.deepEqual(rows.map((r) => r.name), ['a', 'b', 'c']);
});

test('turso driver: execRaw() runs DDL directly, runScript() runs a multi-statement script', async () => {
  const d = await createDriver({ tursoUrl: `file:${join(dir, 'exec.db')}` });
  await runScript(d, `
    CREATE TABLE x (id INTEGER PRIMARY KEY);
    CREATE TABLE y (id INTEGER PRIMARY KEY);
  `);
  const tables = await d.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", []);
  assert.deepEqual(tables.map((t) => t.name), ['x', 'y']);
});

test('turso driver: transaction() commits all writes together', async () => {
  const d = await freshDriver('tx-commit.db');
  await d.transaction(async (tx) => {
    await tx.run('INSERT INTO t (name, n) VALUES (?, ?)', ['x', 1]);
    await tx.run('INSERT INTO t (name, n) VALUES (?, ?)', ['y', 2]);
  });
  const rows = await d.all('SELECT * FROM t ORDER BY name', []);
  assert.equal(rows.length, 2);
});

test('turso driver: transaction() rolls back every write when the callback throws', async () => {
  const d = await freshDriver('tx-rollback.db');
  await d.run('INSERT INTO t (name, n) VALUES (?, ?)', ['before', 0]);
  await assert.rejects(
    d.transaction(async (tx) => {
      await tx.run('INSERT INTO t (name, n) VALUES (?, ?)', ['during', 1]);
      throw new Error('boom');
    }),
    /boom/
  );
  const rows = await d.all('SELECT * FROM t', []);
  assert.deepEqual(rows.map((r) => r.name), ['before']);
});

test('turso driver: transaction() return value passes through, and get/all work inside it', async () => {
  const d = await freshDriver('tx-readback.db');
  await d.run('INSERT INTO t (name, n) VALUES (?, ?)', ['seed', 1]);
  const result = await d.transaction(async (tx) => {
    const existing = await tx.get('SELECT * FROM t WHERE name = ?', ['seed']);
    await tx.run('INSERT INTO t (name, n) VALUES (?, ?)', ['derived', existing.n + 1]);
    return (await tx.all('SELECT * FROM t', [])).length;
  });
  assert.equal(result, 2);
});
