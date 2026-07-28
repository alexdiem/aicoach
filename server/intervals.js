// intervals.icu API client.
//
// Auth is HTTP Basic with username "API_KEY" and the key as the password
// (https://forum.intervals.icu/t/api-access-to-intervals-icu/609).
// Athlete id "0" resolves to the key's owner on most endpoints; we still
// resolve the real id on first use so activity URLs and caching are stable.

import { getSetting, setSetting } from './db.js';

const BASE = 'https://intervals.icu/api/v1';

export class IntervalsError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'IntervalsError';
    this.status = status;
    this.body = body;
  }
}

function authHeader(key) {
  return 'Basic ' + Buffer.from(`API_KEY:${key}`).toString('base64');
}

async function request(path, { key, params } = {}) {
  const apiKey = key || (await getSetting('intervals_api_key'));
  if (!apiKey) {
    throw new IntervalsError(
      'No intervals.icu API key configured. Add it in Settings (intervals.icu → Settings → Developer → API Key).',
      401
    );
  }
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: authHeader(apiKey), Accept: 'application/json' },
    });
  } catch (err) {
    throw new IntervalsError(`Network error calling intervals.icu: ${err.message}`, 0);
  }
  const text = await res.text();
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403
        ? ' — check the API key and athlete id in Settings.'
        : '';
    throw new IntervalsError(
      `intervals.icu ${res.status} ${res.statusText} on ${path}${hint}`,
      res.status,
      text.slice(0, 500)
    );
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new IntervalsError(`Unparseable response from ${path}`, res.status, text.slice(0, 200));
  }
}

/** Normalise "i123456" / "123456" / "0" forms. */
function normId(id) {
  const s = String(id || '0').trim();
  return s || '0';
}

export async function getAthleteId({ key } = {}) {
  const configured = normId(await getSetting('intervals_athlete_id', '0'));
  if (configured !== '0') return configured;
  const me = await request('/athlete/0', { key });
  const id = me && (me.id || me.athlete?.id);
  if (id) {
    await setSetting('intervals_athlete_id', String(id));
    return String(id);
  }
  return '0';
}

export async function fetchAthlete({ key } = {}) {
  const id = await getAthleteId({ key });
  const a = await request(`/athlete/${id}`, { key });
  return a?.athlete || a;
}

/**
 * Activities in [oldest, newest] (inclusive, local dates).
 * intervals.icu caps the range, so we page month-by-month for long histories.
 */
export async function fetchActivities({ key, oldest, newest } = {}) {
  const id = await getAthleteId({ key });
  const out = [];
  const seen = new Set();
  let cursor = oldest;
  while (cursor <= newest) {
    const chunkEnd = minDate(addMonths(cursor, 3), newest);
    const rows = await request(`/athlete/${id}/activities`, {
      key,
      params: { oldest: cursor, newest: chunkEnd },
    });
    for (const r of rows || []) {
      if (r?.id && !seen.has(r.id)) {
        seen.add(r.id);
        out.push(r);
      }
    }
    if (chunkEnd === newest) break;
    cursor = addDaysStr(chunkEnd, 1);
  }
  return out;
}

export async function fetchWellness({ key, oldest, newest } = {}) {
  const id = await getAthleteId({ key });
  const rows = await request(`/athlete/${id}/wellness`, {
    key,
    params: { oldest, newest },
  });
  return rows || [];
}

/** Interval/lap breakdown for one activity — used for W'bal and stream-derived detail. */
export async function fetchActivityIntervals({ key, activityId } = {}) {
  return request(`/activity/${activityId}/intervals`, { key });
}

export async function testConnection(key) {
  const me = await request('/athlete/0', { key });
  const a = me?.athlete || me;
  return {
    ok: true,
    id: a?.id ?? null,
    name: a?.name ?? null,
    sex: a?.sex ?? null,
    ftp: a?.icu_ftp ?? a?.ftp ?? null,
    weight: a?.icu_weight ?? a?.weight ?? null,
  };
}

// --- tiny date helpers (kept local so this module stays standalone) ---------
function addMonths(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
function addDaysStr(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function minDate(a, b) {
  return a < b ? a : b;
}
