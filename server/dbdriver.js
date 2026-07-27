// A tiny driver abstraction so the rest of the app can `await db.get/all/run(...)`
// regardless of whether the backend is a local file (node:sqlite, for `npm start`)
// or a remote database (Turso/libSQL, for Vercel — serverless functions have no
// persistent local disk, so a networked DB is the only option there).
//
// Turso was chosen specifically because libSQL is SQLite-compatible: the schema
// in db.js and nearly every query run unchanged. The only real differences this
// driver has to paper over are (a) sync-vs-async and (b) how a multi-statement
// script gets executed (libSQL's execute() takes exactly one statement at a time).
//
// Selection: TURSO_DATABASE_URL set -> Turso; otherwise -> local sqlite file.
// The sqlite path has zero npm dependencies, same as before. @libsql/client is
// an actual npm package and is only ever imported (dynamically) when a Turso
// URL is configured, so local users who never touch Vercel never need it
// installed.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Split a schema script into individual statements so both backends can run
 * them one at a time. Strips `-- ...` line comments first — the schema's
 * prose comments aren't guaranteed to be semicolon-free ("opt-in; the plan
 * works..."), only the DDL itself is. Safe here because none of our DDL
 * embeds a semicolon inside a string literal or column default. */
export function splitStatements(sql) {
  const withoutComments = sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function normaliseRunResult(lastInsertRowid, changes) {
  return { lastInsertRowid: lastInsertRowid == null ? null : Number(lastInsertRowid), changes: Number(changes ?? 0) };
}

function sqliteDriver(path) {
  mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');

  // A plain object binds @name/:name/$name params directly (no spread); an
  // array binds positional `?` params via spread. See normaliseArgs in db.js.
  //
  // Every method returns a plain value (not a Promise) — `await value` on a
  // non-thenable resolves immediately, so call sites can uniformly `await`
  // regardless of which driver is active, with no overhead on the local path.
  return {
    kind: 'sqlite',
    get(sql, params = []) {
      const stmt = raw.prepare(sql);
      return Array.isArray(params) ? stmt.get(...params) : stmt.get(params);
    },
    all(sql, params = []) {
      const stmt = raw.prepare(sql);
      return Array.isArray(params) ? stmt.all(...params) : stmt.all(params);
    },
    run(sql, params = []) {
      const stmt = raw.prepare(sql);
      const r = Array.isArray(params) ? stmt.run(...params) : stmt.run(params);
      return normaliseRunResult(r.lastInsertRowid, r.changes);
    },
    execRaw(sql) {
      raw.exec(sql);
    },
    async transaction(fn) {
      raw.exec('BEGIN');
      try {
        const result = await fn(this);
        raw.exec('COMMIT');
        return result;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

function tursoDriver(client) {
  return {
    kind: 'turso',
    async get(sql, params = []) {
      const r = await client.execute({ sql, args: params });
      return r.rows[0] ?? undefined;
    },
    async all(sql, params = []) {
      const r = await client.execute({ sql, args: params });
      return r.rows;
    },
    async run(sql, params = []) {
      const r = await client.execute({ sql, args: params });
      return normaliseRunResult(r.lastInsertRowid, r.rowsAffected);
    },
    async execRaw(sql) {
      await client.execute(sql);
    },
    async transaction(fn) {
      const tx = await client.transaction('write');
      const txDriver = {
        kind: 'turso',
        async get(sql, params = []) {
          const r = await tx.execute({ sql, args: params });
          return r.rows[0] ?? undefined;
        },
        async all(sql, params = []) {
          const r = await tx.execute({ sql, args: params });
          return r.rows;
        },
        async run(sql, params = []) {
          const r = await tx.execute({ sql, args: params });
          return normaliseRunResult(r.lastInsertRowid, r.rowsAffected);
        },
      };
      try {
        const result = await fn(txDriver);
        await tx.commit();
        return result;
      } catch (e) {
        await tx.rollback();
        throw e;
      }
    },
  };
}

/**
 * Create the active driver. Call once at startup.
 *   createDriver({ sqlitePath })            -> local file (default, no deps)
 *   createDriver({ tursoUrl, tursoToken })   -> Turso (Vercel deployment)
 */
export async function createDriver({ sqlitePath, tursoUrl, tursoToken } = {}) {
  if (tursoUrl) {
    const { createClient } = await import('@libsql/client');
    const client = createClient({ url: tursoUrl, authToken: tursoToken });
    return tursoDriver(client);
  }
  return sqliteDriver(sqlitePath);
}

/** Run a schema script (possibly multi-statement) against any driver. */
export async function runScript(driver, sql) {
  for (const stmt of splitStatements(sql)) {
    await driver.execRaw(stmt);
  }
}
