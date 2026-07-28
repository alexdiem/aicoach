// Storage layer. Two backends behind one async interface (see dbdriver.js):
//   - local sqlite file, via node:sqlite — the default, zero npm dependencies,
//     what `npm start` uses.
//   - Turso (libSQL), via @libsql/client — selected when TURSO_DATABASE_URL is
//     set, which is how the Vercel deployment gets a persistent database
//     (serverless functions have no durable local disk to put a file on).
//
// Every exported function here is async now, even the ones that only need a
// synchronous local read, so callers don't have to know which backend is live.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDriver, runScript } from './dbdriver.js';

const here = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.AICOACH_DB || resolve(here, '..', 'data', 'aicoach.db');

const TURSO_URL = process.env.TURSO_DATABASE_URL || null;

// Vercel always sets VERCEL=1 in its function runtime. Its deployment bundle
// is read-only (only /tmp is writable, and it doesn't persist between
// invocations anyway), so falling through to the local-sqlite-file path there
// fails as a confusing ENOENT/EROFS from mkdir deep inside node:sqlite. Fail
// fast with the actual problem instead.
if (process.env.VERCEL && !TURSO_URL) {
  throw new Error(
    'Running on Vercel but TURSO_DATABASE_URL is not set. Vercel functions have no persistent ' +
      'local disk, so this app needs a Turso database there — create one and set ' +
      'TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN) in the Vercel project\'s environment variables, ' +
      'then redeploy. See the README\'s "Deploying to Vercel" section.'
  );
}

let driverPromise = null;
function driver() {
  if (!driverPromise) {
    driverPromise = createDriver({
      sqlitePath: DB_PATH,
      tursoUrl: TURSO_URL,
      tursoToken: process.env.TURSO_AUTH_TOKEN || undefined,
    });
  }
  return driverPromise;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Athlete constants used by the planner. Seeded from intervals.icu on sync,
-- overridable in the UI (intervals' eFTP is not always the number you train by).
CREATE TABLE IF NOT EXISTS athlete (
  id            TEXT PRIMARY KEY,
  name          TEXT,
  sex           TEXT,
  ftp           REAL,
  weight_kg     REAL,
  max_hr        INTEGER,
  resting_hr    INTEGER,
  threshold_hr  INTEGER,
  age           INTEGER,
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS goals (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'event',
  sport          TEXT NOT NULL DEFAULT 'Ride',
  event_date     TEXT NOT NULL,
  start_date     TEXT NOT NULL,
  priority       TEXT DEFAULT 'A',
  distance_km    REAL,
  elevation_m    REAL,
  est_duration_h REAL,
  support        TEXT DEFAULT 'supported',
  terrain        TEXT,
  target_metric  TEXT,
  target_value   REAL,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id      INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  generated_at TEXT NOT NULL,
  reason       TEXT,
  params_json  TEXT,
  notes_json   TEXT,
  active       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_plans_goal ON plans(goal_id, active);

CREATE TABLE IF NOT EXISTS plan_weeks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id           INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  week_index        INTEGER NOT NULL,
  start_date        TEXT NOT NULL,
  end_date          TEXT NOT NULL,
  phase             TEXT NOT NULL,
  block_index       INTEGER,
  week_in_block     INTEGER,
  is_recovery       INTEGER NOT NULL DEFAULT 0,
  target_tss        REAL,
  target_hours      REAL,
  z1_2_pct          REAL,
  z3_4_pct          REAL,
  z5_pct            REAL,
  long_session_h    REAL,
  long_session_tss  REAL,
  strength_sessions INTEGER,
  key_sessions_json TEXT,
  projected_ctl     REAL,
  focus             TEXT,
  governing_json    TEXT,
  notes             TEXT
);
CREATE INDEX IF NOT EXISTS idx_plan_weeks ON plan_weeks(plan_id, start_date);

CREATE TABLE IF NOT EXISTS activities (
  id             TEXT PRIMARY KEY,
  athlete_id     TEXT,
  date           TEXT NOT NULL,
  start_local    TEXT,
  type           TEXT,
  name           TEXT,
  description    TEXT,
  moving_time    INTEGER,
  elapsed_time   INTEGER,
  distance_m     REAL,
  elevation_m    REAL,
  tss            REAL,
  intensity      REAL,
  np             REAL,
  avg_power      REAL,
  max_power      REAL,
  vi             REAL,
  ef             REAL,
  trimp          REAL,
  avg_hr         REAL,
  max_hr         REAL,
  decoupling     REAL,
  ctl            REAL,
  atl            REAL,
  tsb            REAL,
  ftp            REAL,
  eftp           REAL,
  w_prime        REAL,
  wbal_min       REAL,
  wbal_drop      REAL,
  kj             REAL,
  z_times_json   TEXT,
  hr_z_times_json TEXT,
  raw_json       TEXT,
  synced_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date);

CREATE TABLE IF NOT EXISTS wellness (
  date              TEXT PRIMARY KEY,
  ctl               REAL,
  atl               REAL,
  ramp_rate         REAL,
  resting_hr        REAL,
  hrv               REAL,
  sleep_secs        REAL,
  sleep_score       REAL,
  weight            REAL,
  kcal_consumed     REAL,
  menstrual_phase   TEXT,
  menstrual_predicted TEXT,
  soreness          REAL,
  fatigue           REAL,
  stress            REAL,
  mood              REAL,
  motivation        REAL,
  injury            REAL,
  readiness         REAL,
  comments          TEXT,
  raw_json          TEXT
);

-- Per-ride subjective log. The back-pain monitoring feature lives here.
CREATE TABLE IF NOT EXISTS ride_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id   TEXT UNIQUE REFERENCES activities(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,
  position      TEXT,
  drops_minutes REAL,
  back_pain     TEXT,
  pain_onset    TEXT,
  rpe           INTEGER,
  cycle_phase   TEXT,
  carb_g_per_h  REAL,
  protein_g     REAL,
  notes         TEXT,
  source        TEXT DEFAULT 'manual',
  created_at    TEXT,
  updated_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_ride_logs_date ON ride_logs(date);

-- Optional daily log. Everything here is opt-in; the plan works without it.
CREATE TABLE IF NOT EXISTS daily_logs (
  date          TEXT PRIMARY KEY,
  cycle_phase   TEXT,
  cycle_day     INTEGER,
  period_start  INTEGER DEFAULT 0,
  intake_kcal   REAL,
  protein_g     REAL,
  back_pain     TEXT,
  symptoms      TEXT,
  notes         TEXT,
  updated_at    TEXT
);

-- One brief per week, rewritten in place when the week is re-run. plan_id
-- records which plan version it was written against; it is deliberately NOT
-- part of the key, or every replan would fork the week's history.
CREATE TABLE IF NOT EXISTS briefs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id         INTEGER REFERENCES plans(id) ON DELETE SET NULL,
  goal_id         INTEGER,
  week_start      TEXT NOT NULL UNIQUE,
  generated_at    TEXT NOT NULL,
  phase           TEXT,
  headline        TEXT,
  body_md         TEXT,
  metrics_json    TEXT,
  flags_json      TEXT,
  actions_json    TEXT,
  governing_json  TEXT
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  TEXT,
  finished_at TEXT,
  ok          INTEGER,
  activities  INTEGER,
  wellness    INTEGER,
  message     TEXT
);

-- Outstanding background-job failures (scheduled sync, weekly replan, the
-- cron dispatch itself). A job's rows are cleared the next time that same
-- job succeeds, so this table only ever holds *unresolved* failures — the
-- UI can show it directly without separately tracking whether it's stale.
CREATE TABLE IF NOT EXISTS job_failures (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job         TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  message     TEXT
);
`;

let readyPromise = null;

/** Resolve once the driver exists and the schema has been applied. Every
 * exported function below awaits this first, so callers never have to. */
function ready() {
  if (!readyPromise) readyPromise = init();
  return readyPromise;
}

async function init() {
  const d = await driver();
  await runScript(d, SCHEMA);
  await migrate(d);
  return d;
}

/** Idempotent, self-skipping migrations — safe to run against a brand-new
 * Turso database (they'll no-op immediately) or an existing local file. */
async function migrate(d) {
  await ensureColumn(d, 'activities', 'decoupling', 'REAL');
  await ensureColumn(d, 'plan_weeks', 'governing_json', 'TEXT');

  // Early builds keyed briefs on (week_start, plan_id), which forked a week's
  // brief on every replan. Collapse to one row per week, keeping the newest.
  const row = await d.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='briefs'");
  if (row?.sql && /UNIQUE\(week_start,\s*plan_id\)/i.test(row.sql)) {
    await d.transaction(async (tx) => {
      await tx.run(`
        DELETE FROM briefs WHERE id NOT IN (
          SELECT id FROM briefs b WHERE b.generated_at = (
            SELECT MAX(generated_at) FROM briefs x WHERE x.week_start = b.week_start
          ) GROUP BY b.week_start
        )`);
      await tx.run('ALTER TABLE briefs RENAME TO briefs_old');
      await tx.run(`CREATE TABLE briefs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL,
        goal_id INTEGER, week_start TEXT NOT NULL UNIQUE, generated_at TEXT NOT NULL,
        phase TEXT, headline TEXT, body_md TEXT, metrics_json TEXT, flags_json TEXT,
        actions_json TEXT, governing_json TEXT
      )`);
      await tx.run(`INSERT INTO briefs (id, plan_id, goal_id, week_start, generated_at, phase, headline, body_md,
        metrics_json, flags_json, actions_json, governing_json)
        SELECT id, plan_id, goal_id, week_start, generated_at, phase, headline, body_md,
               metrics_json, flags_json, actions_json, governing_json FROM briefs_old`);
      await tx.run('DROP TABLE briefs_old');
    });
  }
}

async function ensureColumn(d, table, column, decl) {
  const cols = await d.all(`PRAGMA table_info(${table})`);
  if (!cols.some((c) => c.name === column)) {
    await d.execRaw(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

// --- compatibility shim --------------------------------------------------
// Every other file in the app was written against the node:sqlite call shape
// (`db.prepare(sql).get(...args)`). Rather than rewrite every call site's
// argument-passing to an array, `db.prepare(sql)` here returns bound closures
// with the same signature — each just awaits the driver. Callers only need to
// add `await` in front of the existing `.get/.all/.run(...)` call and mark
// their function `async`; the call shape itself doesn't change. `db.exec(sql)`
// is kept for the handful of ad-hoc multi-statement scripts (e.g. the test
// suite resetting tables between cases).
// A handful of statements (the intervals.icu upserts) bind a single object of
// @name-style params — the node:sqlite convention for `.run(anObject)`. Spread
// through `(...args)` that arrives as `[anObject]`; unwrap it back to the bare
// object so the driver sees named params, not a positional array holding one
// object (which would be meaningless to bind).
function normaliseArgs(args) {
  if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    return args[0];
  }
  return args;
}

export const db = {
  prepare(sql) {
    return {
      get: async (...args) => dbGet(sql, normaliseArgs(args)),
      all: async (...args) => dbAll(sql, normaliseArgs(args)),
      run: async (...args) => dbRun(sql, normaliseArgs(args)),
    };
  },
  async exec(sql) {
    const d = await ready();
    await runScript(d, sql);
  },
};

// --- thin re-exports so the rest of the app can `await db.get/all/run(...)`
export async function dbGet(sql, params) {
  const d = await ready();
  return d.get(sql, params);
}
export async function dbAll(sql, params) {
  const d = await ready();
  return d.all(sql, params);
}
export async function dbRun(sql, params) {
  const d = await ready();
  return d.run(sql, params);
}
export async function dbTransaction(fn) {
  const d = await ready();
  return d.transaction(fn);
}

// --- settings helpers -------------------------------------------------------
const DEFAULTS = {
  intervals_api_key: '',
  intervals_athlete_id: '0',
  sync_days_back: '400',
  auto_sync_hours: '6',
  auto_replan_enabled: '1',
  ef_if_min: '0.55',
  ef_if_max: '0.88',
  ef_min_minutes: '45',
  high_if_threshold: '0.80',
  load_pattern: '3:1',
  max_ramp_base: '6',
  max_ramp_build: '4',
};

export async function getSetting(key, fallback = null) {
  const row = await dbGet('SELECT value FROM settings WHERE key = ?', [key]);
  if (row && row.value != null) return row.value;
  if (key in DEFAULTS) return DEFAULTS[key];
  return fallback;
}

export async function getSettingNum(key, fallback = null) {
  const v = parseFloat(await getSetting(key));
  return Number.isFinite(v) ? v : fallback;
}

export async function setSetting(key, value) {
  await dbRun('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    value == null ? null : String(value),
  ]);
}

export async function allSettings() {
  const rows = await dbAll('SELECT key, value FROM settings', []);
  const out = { ...DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function getAthlete() {
  return (
    (await dbGet('SELECT * FROM athlete ORDER BY updated_at DESC LIMIT 1', [])) || {
      id: 'local',
      name: null,
      ftp: null,
      weight_kg: null,
      max_hr: null,
      resting_hr: null,
      threshold_hr: null,
      age: null,
      sex: null,
    }
  );
}

// --- job failure tracking ---------------------------------------------------

export async function recordJobFailure(job, message) {
  await dbRun('INSERT INTO job_failures (job, occurred_at, message) VALUES (?, ?, ?)', [
    job,
    new Date().toISOString(),
    message || null,
  ]);
}

export async function clearJobFailures(job) {
  await dbRun('DELETE FROM job_failures WHERE job = ?', [job]);
}

export async function activeJobFailures() {
  return dbAll('SELECT * FROM job_failures ORDER BY id DESC', []);
}

export async function upsertAthlete(a) {
  const cur = await getAthlete();
  const merged = { ...cur, ...a, id: a.id || cur.id || 'local', updated_at: new Date().toISOString() };
  await dbRun(
    `INSERT INTO athlete (id, name, sex, ftp, weight_kg, max_hr, resting_hr, threshold_hr, age, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, sex=excluded.sex, ftp=excluded.ftp, weight_kg=excluded.weight_kg,
       max_hr=excluded.max_hr, resting_hr=excluded.resting_hr, threshold_hr=excluded.threshold_hr,
       age=excluded.age, updated_at=excluded.updated_at`,
    [
      merged.id,
      merged.name ?? null,
      merged.sex ?? null,
      merged.ftp ?? null,
      merged.weight_kg ?? null,
      merged.max_hr ?? null,
      merged.resting_hr ?? null,
      merged.threshold_hr ?? null,
      merged.age ?? null,
      merged.updated_at,
    ]
  );
  return getAthlete();
}
