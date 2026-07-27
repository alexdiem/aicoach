// SQLite storage using Node's built-in node:sqlite (Node >= 22.5). No npm deps.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.AICOACH_DB || resolve(here, '..', 'data', 'aicoach.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
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
  kind           TEXT NOT NULL DEFAULT 'event',   -- event | metric
  sport          TEXT NOT NULL DEFAULT 'Ride',    -- Ride | Run | BackcountrySki | Hike | Other
  event_date     TEXT NOT NULL,
  start_date     TEXT NOT NULL,
  priority       TEXT DEFAULT 'A',                -- A | B | C
  distance_km    REAL,
  elevation_m    REAL,
  est_duration_h REAL,                            -- user override; else estimated
  support        TEXT DEFAULT 'supported',        -- self-supported | supported
  terrain        TEXT,
  target_metric  TEXT,                            -- for kind='metric', e.g. 'ftp'
  target_value   REAL,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'active',  -- active | archived
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id      INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  generated_at TEXT NOT NULL,
  reason       TEXT,               -- why this version was generated
  params_json  TEXT,               -- inputs snapshot (CTL/ATL/FTP/options) for auditability
  notes_json   TEXT,               -- plan-level warnings, e.g. capped ramp rate
  active       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_plans_goal ON plans(goal_id, active);

CREATE TABLE IF NOT EXISTS plan_weeks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id           INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  week_index        INTEGER NOT NULL,
  start_date        TEXT NOT NULL,
  end_date          TEXT NOT NULL,
  phase             TEXT NOT NULL,     -- prep|base1|base2|base3|build1|build2|peak|taper|race
  block_index       INTEGER,           -- 1-based index of the loading block
  week_in_block     INTEGER,
  is_recovery       INTEGER NOT NULL DEFAULT 0,
  target_tss        REAL,
  target_hours      REAL,
  z1_2_pct          REAL,              -- % of weekly TSS below LT1 (endurance)
  z3_4_pct          REAL,              -- tempo/threshold
  z5_pct            REAL,              -- VO2 and above
  long_session_h    REAL,
  long_session_tss  REAL,
  strength_sessions INTEGER,
  key_sessions_json TEXT,
  projected_ctl     REAL,
  focus             TEXT,
  governing_json    TEXT,              -- [{decision, framework, reason, ...}]
  notes             TEXT
);
CREATE INDEX IF NOT EXISTS idx_plan_weeks ON plan_weeks(plan_id, start_date);

CREATE TABLE IF NOT EXISTS activities (
  id             TEXT PRIMARY KEY,
  athlete_id     TEXT,
  date           TEXT NOT NULL,       -- local YYYY-MM-DD
  start_local    TEXT,
  type           TEXT,
  name           TEXT,
  description    TEXT,
  moving_time    INTEGER,
  elapsed_time   INTEGER,
  distance_m     REAL,
  elevation_m    REAL,
  tss            REAL,
  intensity      REAL,                -- IF
  np             REAL,
  avg_power      REAL,
  max_power      REAL,
  vi             REAL,
  ef             REAL,                -- NP / avg HR (or intervals' value)
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
  wbal_min       REAL,                -- lowest W'bal reached (J)
  wbal_drop      REAL,                -- W' consumed = w_prime - wbal_min (J)
  kj             REAL,
  z_times_json   TEXT,                -- power zone seconds
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
  position      TEXT,        -- upright | drops | mixed
  drops_minutes REAL,        -- optional, if known/estimated
  back_pain     TEXT,        -- none | mild | moderate | flare
  pain_onset    TEXT,        -- during | after | next_day
  rpe           INTEGER,
  cycle_phase   TEXT,        -- optional Sims input, per-ride override
  carb_g_per_h  REAL,
  protein_g     REAL,
  notes         TEXT,
  source        TEXT DEFAULT 'manual',  -- manual | tags (parsed from intervals description)
  created_at    TEXT,
  updated_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_ride_logs_date ON ride_logs(date);

-- Optional daily log. Everything here is opt-in; the plan works without it.
CREATE TABLE IF NOT EXISTS daily_logs (
  date          TEXT PRIMARY KEY,
  cycle_phase   TEXT,        -- menstrual | follicular | ovulation | luteal_early | luteal_late
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
`);

// --- lightweight migrations -------------------------------------------------
function ensureColumn(table, column, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}
ensureColumn('activities', 'decoupling', 'REAL');
ensureColumn('plan_weeks', 'governing_json', 'TEXT');

// Early builds keyed briefs on (week_start, plan_id), which forked a week's
// brief on every replan. Collapse to one row per week, keeping the newest.
const briefsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='briefs'").get()?.sql || '';
if (/UNIQUE\(week_start,\s*plan_id\)/i.test(briefsSql)) {
  db.exec(`
    BEGIN;
    DELETE FROM briefs WHERE id NOT IN (
      SELECT id FROM briefs b WHERE b.generated_at = (
        SELECT MAX(generated_at) FROM briefs x WHERE x.week_start = b.week_start
      ) GROUP BY b.week_start
    );
    ALTER TABLE briefs RENAME TO briefs_old;
    CREATE TABLE briefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL,
      goal_id INTEGER, week_start TEXT NOT NULL UNIQUE, generated_at TEXT NOT NULL,
      phase TEXT, headline TEXT, body_md TEXT, metrics_json TEXT, flags_json TEXT,
      actions_json TEXT, governing_json TEXT
    );
    INSERT INTO briefs (id, plan_id, goal_id, week_start, generated_at, phase, headline, body_md,
      metrics_json, flags_json, actions_json, governing_json)
      SELECT id, plan_id, goal_id, week_start, generated_at, phase, headline, body_md,
             metrics_json, flags_json, actions_json, governing_json FROM briefs_old;
    DROP TABLE briefs_old;
    COMMIT;
  `);
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
  sims_enabled: '1',
  load_pattern: '3:1',
  max_ramp_base: '6',
  max_ramp_build: '4',
};

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row && row.value != null) return row.value;
  if (key in DEFAULTS) return DEFAULTS[key];
  return fallback;
}

export function getSettingNum(key, fallback = null) {
  const v = parseFloat(getSetting(key));
  return Number.isFinite(v) ? v : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value == null ? null : String(value));
}

export function allSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function getAthlete() {
  return (
    db.prepare('SELECT * FROM athlete ORDER BY updated_at DESC LIMIT 1').get() || {
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

export function upsertAthlete(a) {
  const cur = getAthlete();
  const merged = { ...cur, ...a, id: a.id || cur.id || 'local', updated_at: new Date().toISOString() };
  db.prepare(
    `INSERT INTO athlete (id, name, sex, ftp, weight_kg, max_hr, resting_hr, threshold_hr, age, updated_at)
     VALUES (@id, @name, @sex, @ftp, @weight_kg, @max_hr, @resting_hr, @threshold_hr, @age, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, sex=excluded.sex, ftp=excluded.ftp, weight_kg=excluded.weight_kg,
       max_hr=excluded.max_hr, resting_hr=excluded.resting_hr, threshold_hr=excluded.threshold_hr,
       age=excluded.age, updated_at=excluded.updated_at`
  ).run({
    id: merged.id,
    name: merged.name ?? null,
    sex: merged.sex ?? null,
    ftp: merged.ftp ?? null,
    weight_kg: merged.weight_kg ?? null,
    max_hr: merged.max_hr ?? null,
    resting_hr: merged.resting_hr ?? null,
    threshold_hr: merged.threshold_hr ?? null,
    age: merged.age ?? null,
    updated_at: merged.updated_at,
  });
  return getAthlete();
}
