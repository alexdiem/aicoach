// JSON API. Route table is a flat map of "METHOD /path" → handler.
// Path segments starting with ":" are captured into `params`.

import { db, allSettings, setSetting, getAthlete, upsertAthlete, getSetting } from './db.js';
import { addDays, isoDate, round, today, weekStart } from './util.js';
import { syncFromIntervals, lastSync } from './sync.js';
import { testConnection } from './intervals.js';
import {
  currentFitness, fitnessSeries, recentWeeks, weekActuals, compareWeek, efSamples, efTrend,
  rampRate, activitiesBetween,
} from './metrics.js';
import {
  generatePlan, savePlan, activePlan, planWeeks, weekForDate, activeGoal, regenerate, estimateDuration,
  durationClass, adaptationInputs,
} from './planner.js';
import { buildBrief, saveBrief, getBrief, listBriefs, runWeekly } from './brief.js';
import { painCorrelation, upsertRideLog, loggedRides, recentPain } from './backpain.js';
import { cycleSummary, hasCycleData, phaseFor, phaseForWeek } from './cycle.js';

const MASK = '••••••••';

function maskedSettings() {
  const s = allSettings();
  return { ...s, intervals_api_key: s.intervals_api_key ? MASK : '' };
}

function requireGoal(query) {
  const id = query.goalId ? parseInt(query.goalId, 10) : null;
  const goal = id ? db.prepare('SELECT * FROM goals WHERE id = ?').get(id) : activeGoal();
  return goal;
}

export const routes = {
  'GET /api/status': async () => {
    const goal = activeGoal();
    const plan = goal ? activePlan(goal.id) : null;
    const fit = currentFitness();
    return {
      settings: maskedSettings(),
      hasApiKey: !!getSetting('intervals_api_key'),
      athlete: getAthlete(),
      lastSync: lastSync(),
      goal,
      plan: plan ? { ...plan, notes: safeJson(plan.notes_json), params: safeJson(plan.params_json) } : null,
      fitness: { ...fit, ramp: rampRate() },
      cycleDataPresent: hasCycleData(),
      counts: {
        activities: db.prepare('SELECT COUNT(*) c FROM activities').get().c,
        rideLogs: db.prepare('SELECT COUNT(*) c FROM ride_logs').get().c,
        briefs: db.prepare('SELECT COUNT(*) c FROM briefs').get().c,
      },
      today: today(),
    };
  },

  'GET /api/settings': async () => maskedSettings(),

  'POST /api/settings': async ({ body }) => {
    for (const [k, v] of Object.entries(body || {})) {
      if (k === 'intervals_api_key' && (v === MASK || v === '')) continue; // don't clobber with the mask
      setSetting(k, v);
    }
    return maskedSettings();
  },

  'POST /api/settings/test': async ({ body }) => {
    const key = body?.key && body.key !== MASK ? body.key : getSetting('intervals_api_key');
    const res = await testConnection(key);
    return res;
  },

  'POST /api/athlete': async ({ body }) => upsertAthlete(body || {}),

  // --- sync ----------------------------------------------------------------
  'POST /api/sync': async ({ body }) => {
    const res = await syncFromIntervals({ daysBack: body?.daysBack ? parseInt(body.daysBack, 10) : undefined });
    return { ...res, lastSync: lastSync() };
  },

  'GET /api/sync/history': async () => db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 20').all(),

  // --- goals ---------------------------------------------------------------
  'GET /api/goals': async () => db.prepare('SELECT * FROM goals ORDER BY event_date').all(),

  'POST /api/goals': async ({ body }) => {
    const g = body || {};
    if (!g.name || !g.event_date) throw httpError(400, 'name and event_date are required');
    const start = g.start_date || today();
    const info = db
      .prepare(
        `INSERT INTO goals (name, kind, sport, event_date, start_date, priority, distance_km, elevation_m,
          est_duration_h, support, terrain, target_metric, target_value, notes, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?)`
      )
      .run(
        g.name, g.kind || 'event', g.sport || 'Ride', g.event_date, start, g.priority || 'A',
        numOrNull(g.distance_km), numOrNull(g.elevation_m), numOrNull(g.est_duration_h),
        g.support || 'supported', g.terrain || null, g.target_metric || null, numOrNull(g.target_value),
        g.notes || null, new Date().toISOString()
      );
    const goalId = Number(info.lastInsertRowid);
    const result = generatePlan(goalId, { reason: 'goal created' });
    const saved = savePlan(result);
    return { goal: db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId), plan: saved, summary: planSummary(result) };
  },

  'PATCH /api/goals/:id': async ({ params, body }) => {
    const id = parseInt(params.id, 10);
    const cur = db.prepare('SELECT * FROM goals WHERE id = ?').get(id);
    if (!cur) throw httpError(404, 'goal not found');
    const fields = ['name', 'kind', 'sport', 'event_date', 'start_date', 'priority', 'distance_km',
      'elevation_m', 'est_duration_h', 'support', 'terrain', 'target_metric', 'target_value', 'notes', 'status'];
    const sets = [];
    const vals = [];
    for (const f of fields) {
      if (body && f in body) {
        sets.push(`${f} = ?`);
        vals.push(body[f] === '' ? null : body[f]);
      }
    }
    if (sets.length) {
      db.prepare(`UPDATE goals SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    }
    return db.prepare('SELECT * FROM goals WHERE id = ?').get(id);
  },

  'DELETE /api/goals/:id': async ({ params }) => {
    db.prepare('DELETE FROM goals WHERE id = ?').run(parseInt(params.id, 10));
    return { deleted: true };
  },

  /** Dry-run: what a plan for these inputs would look like, without saving. */
  'POST /api/goals/preview': async ({ body }) => {
    const g = body || {};
    const demand = estimateDuration({
      sport: g.sport || 'Ride', distance_km: numOrNull(g.distance_km), elevation_m: numOrNull(g.elevation_m),
      est_duration_h: numOrNull(g.est_duration_h), support: g.support, kind: g.kind || 'event',
    });
    return { demand, class: durationClass(demand.hours) };
  },

  // --- plan ----------------------------------------------------------------
  'GET /api/plan': async ({ query }) => {
    const goal = requireGoal(query);
    if (!goal) return { goal: null, plan: null, weeks: [] };
    const plan = activePlan(goal.id);
    if (!plan) return { goal, plan: null, weeks: [] };
    const weeks = planWeeks(plan.id).map((w) => ({
      ...w,
      key_sessions: safeJson(w.key_sessions_json) || [],
      governing: safeJson(w.governing_json) || [],
      cycle: hasCycleData() ? phaseForWeek(w.start_date) : null,
    }));
    // Attach actuals for weeks that have already happened.
    const cur = weekStart(today());
    for (const w of weeks) {
      if (w.start_date <= cur) {
        const a = weekActuals(w.start_date);
        w.actual = { tss: a.tss, hours: a.hours, sessions: a.sessions, distribution: a.distribution };
        w.comparison = compareWeek(w, a);
      }
    }
    return {
      goal,
      plan: { ...plan, notes: safeJson(plan.notes_json), params: safeJson(plan.params_json) },
      weeks,
      versions: db.prepare('SELECT id, version, generated_at, reason, active FROM plans WHERE goal_id = ? ORDER BY version DESC').all(goal.id),
    };
  },

  'POST /api/plan/regenerate': async ({ body }) => {
    const goal = requireGoal(body || {});
    if (!goal) throw httpError(400, 'no goal');
    const res = regenerate(goal.id, body?.reason || 'manual regenerate');
    return { planId: res.planId, version: res.version, summary: planSummary(res.result), notes: res.result.notes };
  },

  'GET /api/plan/adaptation': async () => adaptationInputs(),

  // --- briefs --------------------------------------------------------------
  'GET /api/brief': async ({ query }) => {
    const ws = weekStart(query.week || today());
    const goal = requireGoal(query);
    const stored = getBrief(ws);
    if (stored) return hydrateBrief(stored);
    const fresh = buildBrief({ goalId: goal?.id ?? null, asOf: query.week || today() });
    return { ...fresh, stored: false };
  },

  'POST /api/brief/run': async ({ body }) => {
    const goal = requireGoal(body || {});
    const res = runWeekly({
      goalId: goal?.id ?? null,
      asOf: body?.week || today(),
      replan: body?.replan !== false,
    });
    return { brief: hydrateBrief(res.brief), replanned: res.replanned };
  },

  'GET /api/briefs': async ({ query }) => listBriefs(parseInt(query.limit || '52', 10)).map(hydrateBrief),

  // --- activities & logs ---------------------------------------------------
  'GET /api/activities': async ({ query }) => {
    const to = query.to || today();
    const from = query.from || addDays(to, -parseInt(query.days || '42', 10));
    const acts = activitiesBetween(from, to).map(stripRaw);
    const logs = new Map(loggedRides(from, to).map((r) => [r.id, r]));
    return acts
      .map((a) => ({ ...a, log: logs.get(a.id) || db.prepare('SELECT * FROM ride_logs WHERE activity_id = ?').get(a.id) || null }))
      .reverse();
  },

  'POST /api/ride-logs': async ({ body }) => {
    if (!body?.date && !body?.activity_id) throw httpError(400, 'activity_id or date required');
    if (!body.date && body.activity_id) {
      const a = db.prepare('SELECT date FROM activities WHERE id = ?').get(body.activity_id);
      body.date = a?.date || today();
    }
    return upsertRideLog(body);
  },

  'GET /api/ride-logs': async ({ query }) => {
    const to = query.to || today();
    const from = query.from || addDays(to, -parseInt(query.days || '180', 10));
    return loggedRides(from, to);
  },

  // --- back pain -----------------------------------------------------------
  'GET /api/backpain': async ({ query }) =>
    painCorrelation({
      days: parseInt(query.days || '365', 10),
      severity: query.severity === 'mild' ? 'mild' : 'moderate',
      highIf: query.highIf ? parseFloat(query.highIf) : null,
      limit: query.limit ? parseInt(query.limit, 10) : null,
    }),

  'GET /api/backpain/events': async ({ query }) => recentPain({ days: parseInt(query.days || '90', 10) }),

  // --- optional Sims inputs ------------------------------------------------
  'GET /api/cycle': async () => cycleSummary(),

  'GET /api/daily-logs': async ({ query }) => {
    const to = query.to || today();
    const from = query.from || addDays(to, -parseInt(query.days || '90', 10));
    return db.prepare('SELECT * FROM daily_logs WHERE date >= ? AND date <= ? ORDER BY date DESC').all(from, to);
  },

  'POST /api/daily-logs': async ({ body }) => {
    const d = body || {};
    if (!d.date) throw httpError(400, 'date required');
    db.prepare(
      `INSERT INTO daily_logs (date, cycle_phase, cycle_day, period_start, intake_kcal, protein_g, back_pain, symptoms, notes, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(date) DO UPDATE SET
         cycle_phase=COALESCE(excluded.cycle_phase, daily_logs.cycle_phase),
         cycle_day=COALESCE(excluded.cycle_day, daily_logs.cycle_day),
         period_start=COALESCE(excluded.period_start, daily_logs.period_start),
         intake_kcal=COALESCE(excluded.intake_kcal, daily_logs.intake_kcal),
         protein_g=COALESCE(excluded.protein_g, daily_logs.protein_g),
         back_pain=COALESCE(excluded.back_pain, daily_logs.back_pain),
         symptoms=COALESCE(excluded.symptoms, daily_logs.symptoms),
         notes=COALESCE(excluded.notes, daily_logs.notes),
         updated_at=excluded.updated_at`
    ).run(
      d.date, d.cycle_phase || null, numOrNull(d.cycle_day), d.period_start ? 1 : 0,
      numOrNull(d.intake_kcal), numOrNull(d.protein_g), d.back_pain || null, d.symptoms || null,
      d.notes || null, new Date().toISOString()
    );
    return db.prepare('SELECT * FROM daily_logs WHERE date = ?').get(d.date);
  },

  // --- metrics -------------------------------------------------------------
  'GET /api/metrics/fitness': async ({ query }) => {
    const to = query.to || today();
    const from = query.from || addDays(to, -parseInt(query.days || '180', 10));
    return fitnessSeries(from, to);
  },

  'GET /api/metrics/weeks': async ({ query }) => {
    const n = parseInt(query.n || '12', 10);
    const weeks = recentWeeks(today(), n);
    const goal = activeGoal();
    const plan = goal ? activePlan(goal.id) : null;
    return weeks.map((w) => {
      const pw = plan ? weekForDate(plan.id, w.weekStart) : null;
      return {
        weekStart: w.weekStart,
        actual: { tss: w.tss, hours: w.hours, sessions: w.sessions, distribution: w.distribution, longestHours: w.longestHours },
        planned: pw ? { tss: pw.target_tss, hours: pw.target_hours, phase: pw.phase, is_recovery: pw.is_recovery,
          z1_2_pct: pw.z1_2_pct, z3_4_pct: pw.z3_4_pct, z5_pct: pw.z5_pct } : null,
        comparison: pw ? compareWeek(pw, w) : null,
      };
    });
  },

  'GET /api/metrics/ef': async ({ query }) => {
    const to = query.to || today();
    const from = query.from || addDays(to, -parseInt(query.days || '180', 10));
    return { samples: efSamples(from, to), trend: efTrend(to) };
  },
};

// --- helpers ----------------------------------------------------------------

function planSummary(result) {
  return {
    demand: result.demand,
    targets: result.targets,
    notes: result.notes,
    cycle: result.cycle,
    weeks: result.weeks.length,
    phases: result.weeks.reduce((acc, w) => {
      acc[w.phase] = (acc[w.phase] || 0) + 1;
      return acc;
    }, {}),
  };
}

function hydrateBrief(b) {
  if (!b) return null;
  return {
    ...b,
    metrics: safeJson(b.metrics_json),
    flags: safeJson(b.flags_json) || [],
    actions: safeJson(b.actions_json) || [],
    governing: safeJson(b.governing_json) || [],
    body: b.body_md,
    weekStart: b.week_start,
    stored: true,
  };
}

function stripRaw(a) {
  const { raw_json, ...rest } = a;
  return rest;
}

function safeJson(s) {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** Match "METHOD /a/b/c" against the route table, capturing ":" segments. */
export function matchRoute(method, pathname) {
  const key = `${method} ${pathname}`;
  if (routes[key]) return { handler: routes[key], params: {} };
  const reqParts = pathname.split('/').filter(Boolean);
  for (const routeKey of Object.keys(routes)) {
    const [m, p] = routeKey.split(' ');
    if (m !== method) continue;
    const parts = p.split('/').filter(Boolean);
    if (parts.length !== reqParts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(':')) params[parts[i].slice(1)] = decodeURIComponent(reqParts[i]);
      else if (parts[i] !== reqParts[i]) { ok = false; break; }
    }
    if (ok) return { handler: routes[routeKey], params };
  }
  return null;
}
