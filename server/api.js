// JSON API. Route table is a flat map of "METHOD /path" → handler.
// Path segments starting with ":" are captured into `params`.

import { db, dbTransaction, allSettings, setSetting, getAthlete, upsertAthlete, getSetting, activeJobFailures } from './db.js';
import { addDays, isoDate, round, today, weekStart } from './util.js';
import { syncFromIntervals, lastSync } from './sync.js';
import { testConnection } from './intervals.js';
import {
  currentFitness, fitnessSeries, recentWeeks, weekActuals, compareWeek, efSamples, efTrend,
  rampRate, activitiesBetween, fuellingSignals,
} from './metrics.js';
import {
  generatePlan, savePlan, activePlan, planWeeks, weekForDate, activeGoal, regenerate, estimateDuration,
  durationClass, adaptationInputs,
} from './planner.js';
import { buildBrief, saveBrief, getBrief, listBriefs, runWeekly, redsScreen, proteinFlag } from './brief.js';
import { buildWorkoutDebrief } from './debrief.js';
import { dailyReadiness } from './readiness.js';
import { painCorrelation, upsertRideLog, loggedRides, recentPain } from './backpain.js';
import { authEnabled, checkPassword, createSessionCookie, clearSessionCookie } from './auth.js';

const MASK = '••••••••';

async function maskedSettings() {
  const s = await allSettings();
  return { ...s, intervals_api_key: s.intervals_api_key ? MASK : '' };
}

async function requireGoal(query) {
  const id = query.goalId ? parseInt(query.goalId, 10) : null;
  return id ? db.prepare('SELECT * FROM goals WHERE id = ?').get(id) : activeGoal();
}

export const routes = {
  // --- auth ------------------------------------------------------------------
  'POST /api/login': async ({ body, res }) => {
    if (!authEnabled()) return { ok: true };
    if (!checkPassword(body?.password)) throw httpError(401, 'incorrect password');
    res.setHeader('Set-Cookie', createSessionCookie());
    return { ok: true };
  },

  'POST /api/logout': async ({ res }) => {
    res.setHeader('Set-Cookie', clearSessionCookie());
    return { ok: true };
  },

  'GET /api/status': async () => {
    const goal = await activeGoal();
    const [plan, fit, settings, hasApiKey, athlete, sync, actCount, rideCount, briefCount, jobFailures] = await Promise.all([
      goal ? activePlan(goal.id) : null,
      currentFitness(),
      maskedSettings(),
      getSetting('intervals_api_key'),
      getAthlete(),
      lastSync(),
      db.prepare('SELECT COUNT(*) c FROM activities').get(),
      db.prepare('SELECT COUNT(*) c FROM ride_logs').get(),
      db.prepare('SELECT COUNT(*) c FROM briefs').get(),
      activeJobFailures(),
    ]);
    const ramp = await rampRate();
    return {
      settings,
      hasApiKey: !!hasApiKey,
      athlete,
      lastSync: sync,
      jobFailures,
      goal,
      plan: plan ? { ...plan, notes: safeJson(plan.notes_json), params: safeJson(plan.params_json) } : null,
      fitness: { ...fit, ramp },
      counts: { activities: actCount.c, rideLogs: rideCount.c, briefs: briefCount.c },
      today: today(),
    };
  },

  'GET /api/settings': async () => maskedSettings(),

  'POST /api/settings': async ({ body }) => {
    for (const [k, v] of Object.entries(body || {})) {
      if (k === 'intervals_api_key' && (v === MASK || v === '')) continue; // don't clobber with the mask
      await setSetting(k, v);
    }
    return maskedSettings();
  },

  'POST /api/settings/test': async ({ body }) => {
    const key = body?.key && body.key !== MASK ? body.key : await getSetting('intervals_api_key');
    return testConnection(key);
  },

  'POST /api/athlete': async ({ body }) => upsertAthlete(body || {}),

  // --- sync ----------------------------------------------------------------
  'POST /api/sync': async ({ body }) => {
    const res = await syncFromIntervals({ daysBack: body?.daysBack ? parseInt(body.daysBack, 10) : undefined });
    return { ...res, lastSync: await lastSync() };
  },

  'GET /api/sync/history': async () => db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 20').all(),

  // --- data export (Turso is the only copy of this data; this is the backup path) --
  'GET /api/export': async () => {
    const [goals, plans, planWeeksRows, activities, wellness, rideLogs, dailyLogs, briefs, syncRuns, athlete, settings] =
      await Promise.all([
        db.prepare('SELECT * FROM goals').all(),
        db.prepare('SELECT * FROM plans').all(),
        db.prepare('SELECT * FROM plan_weeks').all(),
        db.prepare('SELECT * FROM activities').all(),
        db.prepare('SELECT * FROM wellness').all(),
        db.prepare('SELECT * FROM ride_logs').all(),
        db.prepare('SELECT * FROM daily_logs').all(),
        db.prepare('SELECT * FROM briefs').all(),
        db.prepare('SELECT * FROM sync_runs').all(),
        getAthlete(),
        maskedSettings(),
      ]);
    return {
      exportedAt: new Date().toISOString(),
      athlete,
      settings,
      goals,
      plans,
      plan_weeks: planWeeksRows,
      activities,
      wellness,
      ride_logs: rideLogs,
      daily_logs: dailyLogs,
      briefs,
      sync_runs: syncRuns,
    };
  },

  // --- goals ---------------------------------------------------------------
  'GET /api/goals': async () => db.prepare('SELECT * FROM goals ORDER BY event_date').all(),

  'POST /api/goals': async ({ body }) => {
    const g = body || {};
    if (!g.name || !g.event_date) throw httpError(400, 'name and event_date are required');
    const start = g.start_date || today();
    const info = await db
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
    const result = await generatePlan(goalId, { reason: 'goal created' });
    const saved = await savePlan(result);
    const goal = await db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId);
    return { goal, plan: saved, summary: planSummary(result) };
  },

  'PATCH /api/goals/:id': async ({ params, body }) => {
    const id = parseInt(params.id, 10);
    const cur = await db.prepare('SELECT * FROM goals WHERE id = ?').get(id);
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
      await db.prepare(`UPDATE goals SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    }
    return db.prepare('SELECT * FROM goals WHERE id = ?').get(id);
  },

  // Explicit cascade rather than relying on the schema's ON DELETE CASCADE:
  // the Turso driver doesn't turn PRAGMA foreign_keys on, so that constraint
  // is only enforced on the local sqlite path (see dbdriver.js).
  'DELETE /api/goals/:id': async ({ params }) => {
    const id = parseInt(params.id, 10);
    const goal = await db.prepare('SELECT * FROM goals WHERE id = ?').get(id);
    if (!goal) throw httpError(404, 'goal not found');
    await dbTransaction(async (tx) => {
      const plans = await tx.all('SELECT id FROM plans WHERE goal_id = ?', [id]);
      for (const p of plans) {
        await tx.run('UPDATE briefs SET plan_id = NULL WHERE plan_id = ?', [p.id]);
        await tx.run('DELETE FROM plan_weeks WHERE plan_id = ?', [p.id]);
      }
      await tx.run('DELETE FROM plans WHERE goal_id = ?', [id]);
      await tx.run('UPDATE briefs SET goal_id = NULL WHERE goal_id = ?', [id]);
      await tx.run('DELETE FROM goals WHERE id = ?', [id]);
    });
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
    const goal = await requireGoal(query);
    if (!goal) return { goal: null, plan: null, weeks: [] };
    const plan = await activePlan(goal.id);
    if (!plan) return { goal, plan: null, weeks: [] };
    const [rawWeeks, versions] = await Promise.all([
      planWeeks(plan.id),
      db.prepare('SELECT id, version, generated_at, reason, active FROM plans WHERE goal_id = ? ORDER BY version DESC').all(goal.id),
    ]);
    const weeks = rawWeeks.map((w) => ({
      ...w,
      key_sessions: safeJson(w.key_sessions_json) || [],
      governing: safeJson(w.governing_json) || [],
    }));
    // Attach actuals for weeks that have already happened.
    const cur = weekStart(today());
    await Promise.all(
      weeks
        .filter((w) => w.start_date <= cur)
        .map(async (w) => {
          const a = await weekActuals(w.start_date);
          w.actual = { tss: a.tss, hours: a.hours, sessions: a.sessions, distribution: a.distribution };
          w.comparison = compareWeek(w, a);
        })
    );
    return {
      goal,
      plan: { ...plan, notes: safeJson(plan.notes_json), params: safeJson(plan.params_json) },
      weeks,
      versions,
    };
  },

  'POST /api/plan/regenerate': async ({ body }) => {
    const goal = await requireGoal(body || {});
    if (!goal) throw httpError(400, 'no goal');
    const res = await regenerate(goal.id, body?.reason || 'manual regenerate');
    return { planId: res.planId, version: res.version, summary: planSummary(res.result), notes: res.result.notes };
  },

  'GET /api/plan/adaptation': async () => adaptationInputs(),

  'PATCH /api/plan/weeks/:id': async ({ params, body }) => {
    const id = parseInt(params.id, 10);
    const cur = await db.prepare('SELECT * FROM plan_weeks WHERE id = ?').get(id);
    if (!cur) throw httpError(404, 'plan week not found');

    const numFields = ['target_tss', 'target_hours', 'z1_2_pct', 'z3_4_pct', 'z5_pct', 'long_session_h', 'strength_sessions'];
    const textFields = ['focus', 'notes'];
    const sets = [];
    const vals = [];
    for (const f of numFields) {
      if (body && f in body) { sets.push(`${f} = ?`); vals.push(numOrNull(body[f])); }
    }
    for (const f of textFields) {
      if (body && f in body) { sets.push(`${f} = ?`); vals.push(body[f] === '' ? null : body[f]); }
    }
    if (body && 'key_sessions' in body) {
      const sessions = Array.isArray(body.key_sessions)
        ? body.key_sessions.filter((s) => s && (s.name || s.detail)).map((s) => ({ name: s.name || '', detail: s.detail || '' }))
        : [];
      sets.push('key_sessions_json = ?');
      vals.push(JSON.stringify(sessions));
    }
    if (sets.length) {
      await db.prepare(`UPDATE plan_weeks SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    }
    const updated = await db.prepare('SELECT * FROM plan_weeks WHERE id = ?').get(id);
    return { ...updated, key_sessions: safeJson(updated.key_sessions_json) || [], governing: safeJson(updated.governing_json) || [] };
  },

  // A plan version can only be deleted once it's no longer the active one —
  // regenerate (or restore a different version) first to replace it.
  'DELETE /api/plan/:id': async ({ params }) => {
    const id = parseInt(params.id, 10);
    const plan = await db.prepare('SELECT * FROM plans WHERE id = ?').get(id);
    if (!plan) throw httpError(404, 'plan not found');
    if (plan.active) throw httpError(400, "can't delete the active plan version — regenerate first to replace it");
    await dbTransaction(async (tx) => {
      await tx.run('UPDATE briefs SET plan_id = NULL WHERE plan_id = ?', [id]);
      await tx.run('DELETE FROM plan_weeks WHERE plan_id = ?', [id]);
      await tx.run('DELETE FROM plans WHERE id = ?', [id]);
    });
    return { deleted: true };
  },

  // --- briefs --------------------------------------------------------------
  'GET /api/brief': async ({ query }) => {
    const ws = weekStart(query.week || today());
    const goal = await requireGoal(query);
    const stored = await getBrief(ws);
    if (stored) return hydrateBrief(stored);
    const fresh = await buildBrief({ goalId: goal?.id ?? null, asOf: query.week || today() });
    return { ...fresh, stored: false };
  },

  'POST /api/brief/run': async ({ body }) => {
    const goal = await requireGoal(body || {});
    const res = await runWeekly({
      goalId: goal?.id ?? null,
      asOf: body?.week || today(),
      replan: body?.replan !== false,
    });
    return { brief: hydrateBrief(res.brief), replanned: res.replanned };
  },

  'GET /api/briefs': async ({ query }) => (await listBriefs(parseInt(query.limit || '52', 10))).map(hydrateBrief),

  'GET /api/readiness': async ({ query }) => dailyReadiness(query.date || today()),

  // --- activities & logs ---------------------------------------------------
  'GET /api/activities': async ({ query }) => {
    const to = query.to || today();
    const from = query.from || addDays(to, -parseInt(query.days || '42', 10));
    const [rawActs, rides] = await Promise.all([activitiesBetween(from, to), loggedRides(from, to)]);
    const acts = rawActs.map(stripRaw);
    const logs = new Map(rides.map((r) => [r.id, r]));
    const withLogs = await Promise.all(
      acts.map(async (a) => ({ ...a, log: logs.get(a.id) || (await db.prepare('SELECT * FROM ride_logs WHERE activity_id = ?').get(a.id)) || null }))
    );
    return withLogs.reverse();
  },

  'GET /api/activities/:id/debrief': async ({ params }) => {
    const debrief = await buildWorkoutDebrief(params.id);
    if (!debrief) throw httpError(404, 'activity not found');
    return debrief;
  },

  'POST /api/ride-logs': async ({ body }) => {
    if (!body?.date && !body?.activity_id) throw httpError(400, 'activity_id or date required');
    if (!body.date && body.activity_id) {
      const a = await db.prepare('SELECT date FROM activities WHERE id = ?').get(body.activity_id);
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

  'GET /api/daily-logs': async ({ query }) => {
    const to = query.to || today();
    const from = query.from || addDays(to, -parseInt(query.days || '90', 10));
    return db.prepare('SELECT * FROM daily_logs WHERE date >= ? AND date <= ? ORDER BY date DESC').all(from, to);
  },

  'POST /api/daily-logs': async ({ body }) => {
    const d = body || {};
    if (!d.date) throw httpError(400, 'date required');
    await db
      .prepare(
        `INSERT INTO daily_logs (date, intake_kcal, protein_g, back_pain, symptoms, notes, updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(date) DO UPDATE SET
         intake_kcal=COALESCE(excluded.intake_kcal, daily_logs.intake_kcal),
         protein_g=COALESCE(excluded.protein_g, daily_logs.protein_g),
         back_pain=COALESCE(excluded.back_pain, daily_logs.back_pain),
         symptoms=COALESCE(excluded.symptoms, daily_logs.symptoms),
         notes=COALESCE(excluded.notes, daily_logs.notes),
         updated_at=excluded.updated_at`
      )
      .run(
        d.date, numOrNull(d.intake_kcal), numOrNull(d.protein_g), d.back_pain || null, d.symptoms || null,
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
    const [weeks, goal] = await Promise.all([recentWeeks(today(), n), activeGoal()]);
    const plan = goal ? await activePlan(goal.id) : null;
    return Promise.all(
      weeks.map(async (w) => {
        const pw = plan ? await weekForDate(plan.id, w.weekStart) : null;
        return {
          weekStart: w.weekStart,
          actual: { tss: w.tss, hours: w.hours, sessions: w.sessions, distribution: w.distribution, longestHours: w.longestHours },
          planned: pw ? { tss: pw.target_tss, hours: pw.target_hours, phase: pw.phase, is_recovery: pw.is_recovery,
            z1_2_pct: pw.z1_2_pct, z3_4_pct: pw.z3_4_pct, z5_pct: pw.z5_pct } : null,
          comparison: pw ? compareWeek(pw, w) : null,
        };
      })
    );
  },

  'GET /api/metrics/ef': async ({ query }) => {
    const to = query.to || today();
    const from = query.from || addDays(to, -parseInt(query.days || '180', 10));
    const [samples, trend] = await Promise.all([efSamples(from, to), efTrend(to)]);
    return { samples, trend };
  },

  // The rolling numbers behind the protein/RED-S flags, and whether they're
  // currently firing — reuses the exact same checks the weekly brief runs,
  // so a "why isn't this flagging" question has one answer, not two.
  'GET /api/metrics/fuelling': async ({ query }) => {
    const asOf = query.date || today();
    const [fuel, fit, weeks8, athlete] = await Promise.all([
      fuellingSignals(asOf),
      currentFitness(asOf),
      recentWeeks(asOf, 8),
      getAthlete(),
    ]);
    const proteinTarget = athlete?.weight_kg ? round(athlete.weight_kg * 2.0, 0) : null;
    const flags = [redsScreen(fuel, fit, weeks8), proteinFlag(fuel, athlete)].filter(Boolean);
    return { ...fuel, proteinTarget, flags };
  },
};

// --- helpers ----------------------------------------------------------------

function planSummary(result) {
  return {
    demand: result.demand,
    targets: result.targets,
    notes: result.notes,
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
