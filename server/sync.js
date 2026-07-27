// Pull intervals.icu data into SQLite and normalise it.

import { db, getSetting, setSetting, upsertAthlete } from './db.js';
import { fetchActivities, fetchWellness, fetchAthlete } from './intervals.js';
import { addDays, isoDate, num, int, today, round } from './util.js';

/** Read the first present key from a list of candidates. */
function pick(obj, keys, transform = num) {
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== '') {
      const v = transform(obj[k]);
      if (v != null) return v;
    }
  }
  return null;
}

export function normaliseActivity(a) {
  const date = isoDate(a.start_date_local || a.start_date);
  const movingTime = pick(a, ['moving_time', 'icu_recording_time', 'elapsed_time'], int);
  const np = pick(a, ['icu_weighted_avg_watts', 'weighted_average_watts', 'normalized_watts']);
  const avgPower = pick(a, ['icu_average_watts', 'average_watts']);
  const avgHr = pick(a, ['average_heartrate', 'icu_average_hr']);
  const wPrime = pick(a, ['icu_w_prime', 'icu_pm_w_prime']);
  // intervals exposes the minimum W'bal reached under a few names depending on
  // the power-model settings; fall back to w' minus the recorded drop.
  let wbalMin = pick(a, ['icu_wbal_min', 'wbal_min', 'icu_w_prime_min']);
  let wbalDrop = pick(a, ['icu_wbal_drop', 'w_prime_drop']);
  if (wbalDrop == null && wPrime != null && wbalMin != null) wbalDrop = wPrime - wbalMin;
  if (wbalMin == null && wPrime != null && wbalDrop != null) wbalMin = wPrime - wbalDrop;

  let vi = pick(a, ['icu_variability_index', 'variability_index']);
  if (vi == null && np != null && avgPower) vi = np / avgPower;

  let ef = pick(a, ['icu_efficiency_factor', 'efficiency_factor']);
  if (ef == null && np != null && avgHr) ef = np / avgHr;

  const ctl = pick(a, ['icu_ctl']);
  const atl = pick(a, ['icu_atl']);

  return {
    id: String(a.id),
    athlete_id: a.athlete_id != null ? String(a.athlete_id) : null,
    date,
    start_local: a.start_date_local || a.start_date || null,
    type: a.type || a.sport || null,
    name: a.name || null,
    description: a.description || null,
    moving_time: movingTime,
    elapsed_time: pick(a, ['elapsed_time'], int),
    distance_m: pick(a, ['distance']),
    elevation_m: pick(a, ['total_elevation_gain', 'icu_elevation_gain']),
    tss: pick(a, ['icu_training_load', 'training_load', 'tss']),
    intensity: pick(a, ['icu_intensity', 'intensity_factor']),
    np,
    avg_power: avgPower,
    max_power: pick(a, ['max_watts', 'icu_max_watts']),
    vi,
    ef,
    trimp: pick(a, ['trimp', 'icu_trimp']),
    avg_hr: avgHr,
    max_hr: pick(a, ['max_heartrate']),
    decoupling: pick(a, ['decoupling', 'icu_decoupling', 'icu_power_hr_z2_decoupling']),
    ctl,
    atl,
    tsb: ctl != null && atl != null ? ctl - atl : null,
    ftp: pick(a, ['icu_ftp']),
    eftp: pick(a, ['icu_pm_ftp', 'icu_eftp', 'eftp']),
    w_prime: wPrime,
    wbal_min: wbalMin,
    wbal_drop: wbalDrop,
    kj: pick(a, ['icu_joules', 'kilojoules']) != null
      ? (pick(a, ['icu_joules']) != null ? pick(a, ['icu_joules']) / 1000 : pick(a, ['kilojoules']))
      : null,
    z_times_json: a.icu_zone_times ? JSON.stringify(a.icu_zone_times) : null,
    hr_z_times_json: a.icu_hr_zone_times ? JSON.stringify(a.icu_hr_zone_times) : null,
    raw_json: JSON.stringify(a),
    synced_at: new Date().toISOString(),
  };
}

const UPSERT_ACTIVITY = `
INSERT INTO activities (
  id, athlete_id, date, start_local, type, name, description, moving_time, elapsed_time,
  distance_m, elevation_m, tss, intensity, np, avg_power, max_power, vi, ef, trimp,
  avg_hr, max_hr, decoupling, ctl, atl, tsb, ftp, eftp, w_prime, wbal_min, wbal_drop, kj,
  z_times_json, hr_z_times_json, raw_json, synced_at
) VALUES (
  @id, @athlete_id, @date, @start_local, @type, @name, @description, @moving_time, @elapsed_time,
  @distance_m, @elevation_m, @tss, @intensity, @np, @avg_power, @max_power, @vi, @ef, @trimp,
  @avg_hr, @max_hr, @decoupling, @ctl, @atl, @tsb, @ftp, @eftp, @w_prime, @wbal_min, @wbal_drop, @kj,
  @z_times_json, @hr_z_times_json, @raw_json, @synced_at
)
ON CONFLICT(id) DO UPDATE SET
  date=excluded.date, start_local=excluded.start_local, type=excluded.type, name=excluded.name,
  description=excluded.description, moving_time=excluded.moving_time, elapsed_time=excluded.elapsed_time,
  distance_m=excluded.distance_m, elevation_m=excluded.elevation_m, tss=excluded.tss,
  intensity=excluded.intensity, np=excluded.np, avg_power=excluded.avg_power, max_power=excluded.max_power,
  vi=excluded.vi, ef=excluded.ef, trimp=excluded.trimp, avg_hr=excluded.avg_hr, max_hr=excluded.max_hr,
  decoupling=excluded.decoupling, ctl=excluded.ctl, atl=excluded.atl, tsb=excluded.tsb, ftp=excluded.ftp,
  eftp=excluded.eftp, w_prime=excluded.w_prime, wbal_min=excluded.wbal_min, wbal_drop=excluded.wbal_drop,
  kj=excluded.kj, z_times_json=excluded.z_times_json, hr_z_times_json=excluded.hr_z_times_json,
  raw_json=excluded.raw_json, synced_at=excluded.synced_at`;

const UPSERT_WELLNESS = `
INSERT INTO wellness (
  date, ctl, atl, ramp_rate, resting_hr, hrv, sleep_secs, sleep_score, weight, kcal_consumed,
  menstrual_phase, menstrual_predicted, soreness, fatigue, stress, mood, motivation, injury,
  readiness, comments, raw_json
) VALUES (
  @date, @ctl, @atl, @ramp_rate, @resting_hr, @hrv, @sleep_secs, @sleep_score, @weight, @kcal_consumed,
  @menstrual_phase, @menstrual_predicted, @soreness, @fatigue, @stress, @mood, @motivation, @injury,
  @readiness, @comments, @raw_json
)
ON CONFLICT(date) DO UPDATE SET
  ctl=excluded.ctl, atl=excluded.atl, ramp_rate=excluded.ramp_rate, resting_hr=excluded.resting_hr,
  hrv=excluded.hrv, sleep_secs=excluded.sleep_secs, sleep_score=excluded.sleep_score,
  weight=excluded.weight, kcal_consumed=excluded.kcal_consumed, menstrual_phase=excluded.menstrual_phase,
  menstrual_predicted=excluded.menstrual_predicted, soreness=excluded.soreness, fatigue=excluded.fatigue,
  stress=excluded.stress, mood=excluded.mood, motivation=excluded.motivation, injury=excluded.injury,
  readiness=excluded.readiness, comments=excluded.comments, raw_json=excluded.raw_json`;

export function normaliseWellness(w) {
  return {
    date: isoDate(w.id || w.date),
    ctl: num(w.ctl),
    atl: num(w.atl),
    ramp_rate: num(w.rampRate),
    resting_hr: num(w.restingHR),
    hrv: num(w.hrv ?? w.hrvSDNN),
    sleep_secs: num(w.sleepSecs),
    sleep_score: num(w.sleepScore),
    weight: num(w.weight),
    kcal_consumed: num(w.kcalConsumed),
    menstrual_phase: w.menstrualPhase || null,
    menstrual_predicted: w.menstrualPhasePredicted || null,
    soreness: num(w.soreness),
    fatigue: num(w.fatigue),
    stress: num(w.stress),
    mood: num(w.mood),
    motivation: num(w.motivation),
    injury: num(w.injury),
    readiness: num(w.readiness),
    comments: w.comments || null,
    raw_json: JSON.stringify(w),
  };
}

/**
 * Parse structured tags out of an activity's name/description so logging can
 * happen in intervals.icu itself rather than only in this app.
 *   #drops  #upright  #mixed  #drops:90  #pain:mild  #rpe:7  #cycle:luteal  #carbs:60
 */
export function parseTags(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  const out = {};
  if (/#drops\b/.test(t)) out.position = 'drops';
  if (/#upright\b/.test(t)) out.position = 'upright';
  if (/#mixed\b/.test(t)) out.position = 'mixed';
  const dropsMin = t.match(/#drops:(\d+(?:\.\d+)?)/);
  if (dropsMin) {
    out.drops_minutes = parseFloat(dropsMin[1]);
    out.position = out.position || 'mixed';
  }
  const pain = t.match(/#pain:(none|mild|moderate|flare)/);
  if (pain) out.back_pain = pain[1];
  const rpe = t.match(/#rpe:(\d+)/);
  if (rpe) out.rpe = parseInt(rpe[1], 10);
  const cycle = t.match(/#cycle:([a-z_]+)/);
  if (cycle) out.cycle_phase = cycle[1];
  const carbs = t.match(/#carbs:(\d+(?:\.\d+)?)/);
  if (carbs) out.carb_g_per_h = parseFloat(carbs[1]);
  return Object.keys(out).length ? out : null;
}

/**
 * Create/refresh ride_logs rows from tags. Manual edits win: a row whose
 * source is 'manual' is never overwritten by tag parsing.
 */
async function applyTags(activity) {
  const tags = parseTags(`${activity.name || ''} ${activity.description || ''}`);
  if (!tags) return 0;
  const existing = await db.prepare('SELECT * FROM ride_logs WHERE activity_id = ?').get(activity.id);
  const now = new Date().toISOString();
  if (!existing) {
    await db
      .prepare(
        `INSERT INTO ride_logs (activity_id, date, position, drops_minutes, back_pain, rpe,
        cycle_phase, carb_g_per_h, source, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,'tags',?,?)`
      )
      .run(
        activity.id,
        activity.date,
        tags.position ?? null,
        tags.drops_minutes ?? null,
        tags.back_pain ?? null,
        tags.rpe ?? null,
        tags.cycle_phase ?? null,
        tags.carb_g_per_h ?? null,
        now,
        now
      );
    return 1;
  }
  if (existing.source === 'manual') return 0;
  await db
    .prepare(
      `UPDATE ride_logs SET position=?, drops_minutes=?, back_pain=?, rpe=?, cycle_phase=?,
       carb_g_per_h=?, updated_at=? WHERE id=?`
    )
    .run(
      tags.position ?? existing.position,
      tags.drops_minutes ?? existing.drops_minutes,
      tags.back_pain ?? existing.back_pain,
      tags.rpe ?? existing.rpe,
      tags.cycle_phase ?? existing.cycle_phase,
      tags.carb_g_per_h ?? existing.carb_g_per_h,
      now,
      existing.id
    );
  return 1;
}

export async function syncFromIntervals({ daysBack, key } = {}) {
  const started = new Date().toISOString();
  const back = daysBack ?? parseInt(await getSetting('sync_days_back', '400'), 10);
  const newest = addDays(today(), 1);
  const oldest = addDays(today(), -Math.abs(back));

  let nAct = 0;
  let nWell = 0;
  let ok = 1;
  let message = '';

  try {
    // Athlete constants (FTP, weight, HR) seed the planner when not set manually.
    try {
      const a = await fetchAthlete({ key });
      if (a) {
        await upsertAthlete({
          id: a.id != null ? String(a.id) : undefined,
          name: a.name ?? null,
          sex: a.sex ?? null,
          ftp: num(a.icu_ftp ?? a.ftp),
          weight_kg: num(a.icu_weight ?? a.weight),
          max_hr: int(a.icu_max_hr ?? a.max_hr),
          resting_hr: int(a.icu_resting_hr ?? a.resting_hr),
          threshold_hr: int(a.icu_threshold_hr ?? a.lthr),
        });
      }
    } catch (e) {
      message += `athlete: ${e.message}; `;
    }

    const acts = await fetchActivities({ key, oldest, newest });
    const insAct = db.prepare(UPSERT_ACTIVITY);
    for (const raw of acts) {
      const a = normaliseActivity(raw);
      if (!a.date) continue;
      await insAct.run(a);
      await applyTags(a);
      nAct++;
    }

    try {
      const well = await fetchWellness({ key, oldest, newest });
      const insWell = db.prepare(UPSERT_WELLNESS);
      for (const raw of well) {
        const w = normaliseWellness(raw);
        if (!w.date) continue;
        await insWell.run(w);
        nWell++;
      }
    } catch (e) {
      message += `wellness: ${e.message}; `;
    }

    await setSetting('last_sync_at', new Date().toISOString());
  } catch (e) {
    ok = 0;
    message += e.message;
  }

  await db
    .prepare('INSERT INTO sync_runs (started_at, finished_at, ok, activities, wellness, message) VALUES (?,?,?,?,?,?)')
    .run(started, new Date().toISOString(), ok, nAct, nWell, message || null);

  if (!ok) throw new Error(message);
  return { activities: nAct, wellness: nWell, oldest, newest, message: message || null };
}

export async function lastSync() {
  return (await db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1').get()) || null;
}
