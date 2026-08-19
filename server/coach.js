// "Ask your coach" — a chat surface over the coaching logic that already
// exists everywhere else in the app (planner.js, brief.js, backpain.js,
// readiness.js). This file doesn't add any new training logic; its only job
// is to (a) assemble a compact, accurate snapshot of what those modules
// already know as of right now, and (b) hand it to the model with a system
// prompt strict enough that it argues from that snapshot instead of from
// general cycling-coach instinct.
//
// The snapshot is rebuilt on every question rather than cached into the
// conversation, so a five-minute-old "how's this week going" answer doesn't
// go stale mid-chat, and a long conversation doesn't pay for the same data
// twice — only the actual back-and-forth (which the client controls, see
// "New question" in the UI) grows the message list.

import { db, getSetting, getSettingNum, getAthlete } from './db.js';
import { addDays, daysBetween, round, today, weekStart } from './util.js';
import { weekActuals, compareWeek } from './metrics.js';
import {
  activeGoal, activePlan, planWeeks, adaptationInputs, constraintMap,
} from './planner.js';
import { buildBrief, evaluateCompliance } from './brief.js';
import { dailyReadiness } from './readiness.js';
import { painCorrelation } from './backpain.js';

export class CoachError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'CoachError';
    this.status = status;
  }
}

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 1200;
// Independent of the client's "New question" reset — a defensive ceiling so
// one runaway conversation can't quietly become an unbounded, ever-more-
// expensive request no matter what the UI does.
const MAX_HISTORY_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 4000;

function safeJson(s) {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

/**
 * Everything the coach is allowed to know, as of right now. Deliberately a
 * plain object (not markdown) — it goes into the system prompt as a labelled
 * JSON block so the model can't confuse "data" with "instructions".
 */
async function buildContext(asOf = today()) {
  const goal = await activeGoal();
  const [athlete, brief, loadPattern, maxRampBase, maxRampBuild, maxWeeklyHours, strengthPerWeek, readiness, pain] =
    await Promise.all([
      getAthlete(),
      buildBrief({ goalId: goal?.id ?? null, asOf }),
      getSetting('load_pattern', '3:1'),
      getSettingNum('max_ramp_base', 6),
      getSettingNum('max_ramp_build', 4),
      getSettingNum('max_weekly_hours', null),
      getSettingNum('strength_sessions_per_week', 2),
      dailyReadiness(asOf),
      painCorrelation({ asOf }),
    ]);

  let goalSummary = null;
  let planWindow = [];
  if (goal) {
    goalSummary = {
      name: goal.name,
      kind: goal.kind,
      sport: goal.sport,
      status: goal.status,
      startDate: goal.start_date,
      eventDate: goal.event_date,
      daysToEvent: daysBetween(asOf, goal.event_date),
      distanceKm: goal.distance_km,
      elevationM: goal.elevation_m,
      support: goal.support,
      targetMetric: goal.target_metric,
      targetValue: goal.target_value,
      notes: goal.notes,
    };

    const plan = await activePlan(goal.id);
    if (plan) {
      const [weeks, constraints, adapt] = await Promise.all([
        planWeeks(plan.id),
        constraintMap(),
        adaptationInputs(asOf),
      ]);
      const cur = weekStart(asOf);
      const curIdx = weeks.findIndex((w) => w.start_date === cur);
      const from = curIdx === -1 ? 0 : Math.max(0, curIdx - 2);
      const to = curIdx === -1 ? weeks.length : Math.min(weeks.length, curIdx + 5);

      planWindow = await Promise.all(
        weeks.slice(from, to).map(async (w) => {
          const constraint = constraints.get(w.start_date) || null;
          const entry = {
            startDate: w.start_date,
            current: w.start_date === cur,
            phase: w.phase,
            isRecovery: !!w.is_recovery,
            targetTss: w.target_tss,
            targetHours: w.target_hours,
            zones: { z1_2: w.z1_2_pct, z3_4: w.z3_4_pct, z5: w.z5_pct },
            longSessionH: w.long_session_h,
            strengthSessions: w.strength_sessions,
            keySessions: (safeJson(w.key_sessions_json) || []).map((s) => `${s.name}: ${s.detail}`),
            constraint: constraint ? { hours: constraint.hours, reason: constraint.reason } : null,
          };
          // Only a week that's actually finished gets graded — grading the
          // week still in progress against partial actuals reads as a
          // shortfall that hasn't happened yet (same rule GET /api/plan uses).
          if (w.start_date < cur) {
            const actual = await weekActuals(w.start_date);
            entry.actualTss = actual.tss;
            entry.actualHours = actual.hours;
            entry.verdict = evaluateCompliance(compareWeek(w, actual), w, adapt, constraint).text;
          }
          return entry;
        })
      );
    }
  }

  const recentRides = await db
    .prepare(
      `SELECT a.date, a.name, a.type, a.moving_time, a.tss, a.intensity, a.avg_power, a.ef, a.avg_hr, a.decoupling,
              r.position, r.back_pain, r.rpe
       FROM activities a
       LEFT JOIN ride_logs r ON r.activity_id = a.id
       WHERE a.date >= ? AND a.date <= ?
       ORDER BY a.date DESC
       LIMIT 20`
    )
    .all(addDays(asOf, -21), asOf)
    .then((rows) =>
      rows.map((r) => ({
        date: r.date,
        name: r.name,
        type: r.type,
        hours: r.moving_time != null ? round(r.moving_time / 3600, 2) : null,
        tss: r.tss,
        intensity: r.intensity,
        avgPower: r.avg_power,
        ef: r.ef,
        avgHr: r.avg_hr,
        decoupling: r.decoupling,
        position: r.position,
        backPain: r.back_pain,
        rpe: r.rpe,
      }))
    );

  return {
    today: asOf,
    athlete: {
      ftp: athlete.ftp,
      weightKg: athlete.weight_kg,
      maxHr: athlete.max_hr,
      thresholdHr: athlete.threshold_hr,
      age: athlete.age,
      sex: athlete.sex,
    },
    settings: {
      loadPattern,
      maxRampBaseCtlPerWeek: maxRampBase,
      maxRampBuildCtlPerWeek: maxRampBuild,
      maxWeeklyHours: maxWeeklyHours,
      strengthSessionsPerWeek: strengthPerWeek,
    },
    goal: goalSummary,
    thisWeek: goal
      ? {
          headline: brief.headline,
          phase: brief.phase,
          metrics: brief.metrics,
          flags: brief.flags,
          actions: brief.actions,
          governing: brief.governing,
        }
      : null,
    planWindow,
    readiness,
    backPainPattern: pain
      ? { headline: pain.headline, ridesLogged: pain.totalLogged, sufficientData: pain.sufficient }
      : null,
    recentRides,
  };
}

const SYSTEM_PROMPT_HEADER = `You are the AI coach inside aicoach, a personal endurance-training app for one athlete. You are not a general-purpose assistant — you are the voice of the coaching logic this app already runs (Friel periodization, a Stacy Sims/ROAR-informed physiology overlay, and this athlete's own back-pain and fuelling data), answering follow-up questions about what it already concluded.

## The one house rule, inherited from the rest of this app

Every sentence that recommends something names the number that drove it. There is no "listen to your body" branch. If you don't have a number in the DATA block below to cite, say plainly that you don't have the data for that rather than falling back to generic advice — a vague-but-confident answer is worse than "I don't have that logged."

Give a real verdict, not a menu. When the data supports a call, make it — "cut this week to Z2, ramp is 2 over cap" beats "you might consider easing off, but it depends." Hedge only when the data itself is genuinely ambiguous (say why), not as a way to avoid committing.

## Ground rules for using the DATA block

- The DATA block is the complete set of facts you have. Never invent an activity, a date, a number, or a session that isn't in it. If asked about something outside its window (a ride from months ago, for instance), say so and point at the Log or Plan page rather than guessing.
- DATA is refreshed fresh for every message, independent of the conversation so far — always reason from the copy in *this* message, not from something quoted earlier in the chat that may now be stale.
- Numbers in DATA are already the output of this app's own rules (CTL/ATL/TSB, EF trend, compliance verdicts, RED-S/protein screening, back-pain correlation). Don't recompute or second-guess the arithmetic — read it and explain what it means for whatever was asked.

## Frameworks in play, and how to talk about them

- **Friel** governs periodization: phase sequencing, the weekly ramp cap, the 3:1 (or 2:1) load/recovery block pattern, and taper.
- **Sims (ROAR)** governs the *shape* of intensity (polarized, not pyramidal — base weeks run a near-empty moderate zone and one dose of short maximal SIT efforts, not tempo or sweet spot), plus fuelling and RED-S/low-energy-availability screening.
- **Personal** calls are athlete-specific overrides that don't come from either framework as a rule — e.g. a self-reported strength-training frequency, or a week the athlete declared constrained by travel.
- Cycle-phase periodization (dosing training to a menstrual cycle) was deliberately built and then removed from this app — it doesn't apply on hormonal contraception, which is this athlete's situation. Do not suggest reintroducing cycle-phase-based adjustments; if asked, say plainly that this app doesn't do that and why.
- Some things this app does not yet do, even though they're adjacent to what it does track: dynamic warm-up prescriptions, sodium/heat-specific guidance, and strength *progression* (load/reps over time) — only strength *frequency* is tracked. If asked about any of these, say plainly they aren't tracked yet rather than answering as if they were.

## Boundaries

You are a training-load coach, not a clinician. Back-pain correlation and RED-S/low-energy-availability screening in DATA are pattern flags from training numbers, not a diagnosis. If something described in the conversation sounds like it needs medical attention (worsening or acute pain, signs of disordered eating, chest pain, anything outside "adjust the training load"), say so plainly and point to a healthcare professional — once, without turning routine screening flags into a running disclaimer.

## Voice and formatting

Second person, direct, concise — a chat answer, not a brief. Usually a short paragraph or two; a short bullet list only when the question genuinely calls for enumerating things (e.g. "what should this week look like"). Plain prose with light **bold** for the number that matters; no headers, no code blocks, no nested lists — the renderer is minimal and those won't display well.`;

function buildSystemPrompt(context) {
  return `${SYSTEM_PROMPT_HEADER}

## DATA (ground truth, as of ${context.today})

\`\`\`json
${JSON.stringify(context, null, 0)}
\`\`\``;
}

export function validateMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    throw new CoachError('No question to ask.', 400);
  }
  const trimmed = messages.slice(-MAX_HISTORY_MESSAGES);
  if (trimmed[trimmed.length - 1]?.role !== 'user') {
    throw new CoachError('The last message in a conversation must be from you.', 400);
  }
  for (const m of trimmed) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content.trim()) {
      throw new CoachError('Malformed message in conversation.', 400);
    }
    if (m.content.length > MAX_MESSAGE_CHARS) {
      throw new CoachError(`A message is too long (max ${MAX_MESSAGE_CHARS} characters).`, 400);
    }
  }
  return trimmed.map((m) => ({ role: m.role, content: m.content.trim() }));
}

/**
 * Ask the coach. `messages` is the whole conversation so far (the caller owns
 * history — this function is stateless), ending in the newest user turn.
 */
export async function askCoach(messages) {
  const apiKey = await getSetting('anthropic_api_key');
  if (!apiKey) {
    // Deliberately not 401: the frontend's api() helper treats any 401 as
    // "your session expired" and hard-redirects to the login page — exactly
    // wrong for "you haven't configured a *different* API key yet," and it
    // would silently wipe whatever the athlete had just typed.
    throw new CoachError(
      'No Anthropic API key configured. Add one in Settings to use the coach chat.',
      400
    );
  }
  const trimmed = validateMessages(messages);
  const model = (await getSetting('coach_model')) || 'claude-sonnet-5';
  const context = await buildContext();
  const system = buildSystemPrompt(context);

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, max_tokens: MAX_TOKENS, system, messages: trimmed }),
    });
  } catch (err) {
    throw new CoachError(`Network error calling Anthropic: ${err.message}`, 502);
  }

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const apiMessage = data?.error?.message;
    if (res.status === 401 || res.status === 403) {
      // Same reasoning as above: surfaced to the browser as 400, not
      // Anthropic's actual 401/403, so it doesn't trip the login redirect.
      throw new CoachError('Anthropic rejected the API key — check it in Settings.', 400);
    }
    if (res.status === 429) {
      throw new CoachError('Rate limited by Anthropic — try again in a moment.', 429);
    }
    if (res.status >= 500) {
      throw new CoachError('Anthropic is having trouble right now — try again shortly.', 502);
    }
    throw new CoachError(apiMessage || `Anthropic ${res.status} ${res.statusText}`, 502);
  }

  const reply = (data?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  if (!reply) throw new CoachError('Anthropic returned an empty response.', 502);

  return { text: reply, model: data.model || model };
}
