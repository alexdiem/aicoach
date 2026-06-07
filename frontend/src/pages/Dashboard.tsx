import React, { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, Minus, ChevronRight, Moon, Heart, Zap, Battery } from 'lucide-react'
import clsx from 'clsx'
import { getAthleteId, getActivities, getFitnessMetrics, getCurrentPlan, markWorkoutComplete } from '../api/client'
import FitnessChart from '../components/FitnessChart'
import ActivityFeed from '../components/ActivityFeed'
import TrainNow from '../components/TrainNow'
import type { Activity, FitnessMetrics, PlannedWorkout, WeeklyPlan } from '../types'

// ─── Tile wrapper ─────────────────────────────────────────────────────────────

function TileLabel({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 mb-3">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color }}>{children}</span>
    </div>
  )
}

// ─── Signal chips ─────────────────────────────────────────────────────────────

function SignalChip({
  icon: Icon,
  label,
  value,
  sub,
  good,
}: {
  icon: React.ElementType
  label: string
  value: string
  sub?: string
  good?: boolean | null
}) {
  return (
    <div className="flex items-center gap-2 bg-indigo-50 rounded-xl px-2.5 py-2">
      <div className={clsx('w-6 h-6 rounded-md flex items-center justify-center shrink-0',
        good === true ? 'bg-emerald-100' : good === false ? 'bg-rose-100' : 'bg-indigo-100')}>
        <Icon size={11} className={good === true ? 'text-emerald-600' : good === false ? 'text-rose-600' : 'text-indigo-500'} />
      </div>
      <div className="min-w-0">
        <p className="text-[9px] text-gray-400 uppercase tracking-wider leading-none">{label}</p>
        <p className="text-xs font-semibold text-gray-900 leading-tight">{value}</p>
        {sub && <p className="text-[9px] text-gray-400">{sub}</p>}
      </div>
    </div>
  )
}

// ─── Context helpers ──────────────────────────────────────────────────────────

function tsbContext(tsb: number): string {
  if (tsb >= 10) return 'Fresh and race-ready — great time to target a quality effort.'
  if (tsb >= 0) return 'Lightly fresh. Your fitness is working for you right now.'
  if (tsb >= -10) return 'Neutral zone — absorbing training stress normally.'
  if (tsb >= -20) return 'Some fatigue is building. Normal for a build phase.'
  if (tsb >= -30) return 'Carrying meaningful fatigue. Protect your sleep and recovery.'
  return 'Deep fatigue — a rest or recovery day is overdue.'
}

function atlContext(atl: number, ctl: number): string {
  const ratio = ctl > 0 ? atl / ctl : 1
  if (ratio > 1.4) return 'Recent load is well above your fitness baseline — reduce if this persists.'
  if (ratio > 1.15) return 'Recent training load is elevated relative to your fitness — normal in a build block.'
  if (ratio < 0.7) return 'Very light recent load. Good for recovery or a taper week.'
  return 'Recent load is proportionate to your base fitness.'
}

function ctlContext(ctl: number): string {
  if (ctl >= 80) return 'High aerobic base — you\'re well prepared for demanding events.'
  if (ctl >= 55) return 'Solid fitness level for competitive training and events.'
  if (ctl >= 35) return 'Moderate fitness base. Consistent training will build it steadily.'
  if (ctl >= 15) return 'Early-season or returning-athlete range. Room to grow.'
  return 'Fitness base is low — focus on building consistent aerobic volume.'
}

function ctlTrend(series: Array<{ ctl: number }> | undefined): 'up' | 'down' | 'flat' {
  if (!series || series.length < 14) return 'flat'
  const recent = series[series.length - 1].ctl
  const twoWeeksAgo = series[series.length - 14].ctl
  const delta = recent - twoWeeksAgo
  return delta > 2 ? 'up' : delta < -2 ? 'down' : 'flat'
}

// ─── Sport icons + day labels ─────────────────────────────────────────────────

const SPORT_ICONS: Record<string, string> = {
  CYCLING: '🚴',
  RUNNING: '🏃',
  XC_SKIING: '⛷️',
  STRENGTH: '💪',
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const TYPE_ABBREV: Record<string, string> = {
  EASY: 'Easy',
  RECOVERY: 'Rec',
  TEMPO: 'Tempo',
  THRESHOLD: 'Thr',
  VO2MAX: 'VO2',
  LONG: 'Long',
  STRENGTH: 'Str',
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const athleteId = getAthleteId()!
  const [fitness, setFitness] = useState<FitnessMetrics | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [plan, setPlan] = useState<WeeklyPlan | null>(null)
  const [loading, setLoading] = useState(true)

  const todayDow = (new Date().getDay() + 6) % 7

  useEffect(() => {
    Promise.all([
      getFitnessMetrics(athleteId),
      getActivities(athleteId, 20),
      getCurrentPlan(athleteId),
    ])
      .then(([f, a, p]) => {
        setFitness(f)
        setActivities(a)
        setPlan(p)
      })
      .finally(() => setLoading(false))
  }, [athleteId])

  async function handleMarkComplete(workout: PlannedWorkout) {
    await markWorkoutComplete(workout.id, athleteId)
    const updated = await getCurrentPlan(athleteId)
    setPlan(updated)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>
  }

  const current = fitness?.current ?? { ctl: 0, atl: 0, tsb: 0 }
  const readiness = fitness?.readiness
  const signals = readiness?.signals ?? {}

  // Today's workout from plan
  const todayWorkout = plan?.workouts.find((w: PlannedWorkout) => w.day_of_week === todayDow) ?? null

  const tsbPositive = current.tsb >= 0

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gridTemplateRows: 'auto',
        gap: '12px',
      }}
    >
      {/* ── READINESS tile — col 1-2, row 1 ─────────────────────────── */}
      <div
        className="rounded-2xl p-5 border border-gray-200 bg-gray-50"
        style={{ gridColumn: '1 / 3', gridRow: '1' }}
      >
        <TileLabel color="#4338CA">Readiness</TileLabel>

        {readiness ? (
          <div className="flex gap-4 items-start">
            {/* Big score */}
            <div>
              <p className="text-6xl font-black text-indigo-700 tabular-nums leading-none">{readiness.score}</p>
              <p className="text-sm font-semibold text-indigo-500 mt-1">{readiness.zone}</p>
              <p className="text-xs text-gray-500 mt-1 leading-snug max-w-[160px]">{readiness.guidance}</p>
            </div>
            {/* Signal chips */}
            <div className="flex-1 grid grid-cols-2 gap-1.5">
              {signals.body_battery != null && (
                <SignalChip
                  icon={Battery}
                  label="Body battery"
                  value={`${signals.body_battery}%`}
                  good={signals.body_battery >= 60 ? true : signals.body_battery < 30 ? false : null}
                />
              )}
              {signals.hrv_status && (
                <SignalChip
                  icon={Heart}
                  label="HRV status"
                  value={signals.hrv_status}
                  good={signals.hrv_status.toLowerCase() === 'balanced' ? true : signals.hrv_status.toLowerCase() === 'low' ? false : null}
                />
              )}
              {signals.sleep_score != null && (
                <SignalChip
                  icon={Moon}
                  label="Sleep score"
                  value={`${signals.sleep_score}`}
                  sub={signals.sleep_hours ? `${signals.sleep_hours}h` : undefined}
                  good={signals.sleep_score >= 70 ? true : signals.sleep_score < 50 ? false : null}
                />
              )}
              {signals.resting_hr != null && (
                <SignalChip
                  icon={Zap}
                  label="Resting HR"
                  value={`${Math.round(signals.resting_hr)} bpm`}
                />
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400">No readiness data yet.</p>
        )}

        {/* Indigo progress bar */}
        {readiness && (
          <div className="mt-4 h-1.5 bg-indigo-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-600 rounded-full transition-all"
              style={{ width: `${readiness.score}%` }}
            />
          </div>
        )}
      </div>

      {/* ── TODAY'S WORKOUT tile — col 3, row 1 ──────────────────────── */}
      <div
        className="rounded-2xl p-5 border border-violet-100 bg-violet-50"
        style={{ gridColumn: '3', gridRow: '1' }}
      >
        <TileLabel color="#7C3AED">Today's Workout</TileLabel>

        {todayWorkout ? (
          <div className="flex flex-col gap-2">
            <span className="text-4xl leading-none">{SPORT_ICONS[todayWorkout.sport] ?? '🏋️'}</span>
            <span className="inline-flex self-start text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-200 text-violet-700 border border-violet-300">
              {todayWorkout.workout_type}
            </span>
            <p className="text-sm font-bold text-gray-900">{todayWorkout.duration_minutes} min</p>
            <p className="text-xs text-gray-500 leading-snug line-clamp-2">{todayWorkout.purpose}</p>
            {!todayWorkout.is_completed && (
              <button
                onClick={() => handleMarkComplete(todayWorkout)}
                className="mt-1 text-xs text-violet-600 hover:text-violet-800 font-medium transition-colors text-left"
              >
                Mark complete →
              </button>
            )}
            {todayWorkout.is_completed && (
              <span className="text-xs text-emerald-600 font-semibold">✓ Done</span>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-gray-500">No plan yet.</p>
            <a href="/plan" className="inline-flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-medium transition-colors">
              Generate a plan <ChevronRight size={12} />
            </a>
          </div>
        )}
      </div>

      {/* ── TRAIN NOW tile — col 4, rows 1-2 ─────────────────────────── */}
      <div
        className="rounded-2xl border border-indigo-100 bg-indigo-50 overflow-hidden"
        style={{ gridColumn: '4', gridRow: '1 / 3' }}
      >
        <TrainNow athleteId={athleteId} />
      </div>

      {/* ── CTL tile — col 1, row 2 ───────────────────────────────────── */}
      <div
        className="rounded-2xl p-5 border border-blue-100 bg-blue-50"
        style={{ gridColumn: '1', gridRow: '2' }}
      >
        <TileLabel color="#2563EB">Fitness · CTL</TileLabel>
        <div className="flex items-end gap-2 mb-1">
          <p className="text-4xl font-black text-blue-600 tabular-nums leading-none">{Math.round(current.ctl)}</p>
          {(() => {
            const trend = ctlTrend(fitness?.series)
            const Icon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus
            return <Icon size={16} className={trend === 'up' ? 'text-emerald-500' : trend === 'down' ? 'text-rose-500' : 'text-gray-400'} />
          })()}
        </div>
        <p className="text-xs text-gray-500 leading-snug">{ctlContext(current.ctl)}</p>
      </div>

      {/* ── ATL tile — col 2, row 2 ───────────────────────────────────── */}
      <div
        className="rounded-2xl p-5 border border-rose-100 bg-rose-50"
        style={{ gridColumn: '2', gridRow: '2' }}
      >
        <TileLabel color="#DC2626">Fatigue · ATL</TileLabel>
        <div className="flex items-end gap-2 mb-1">
          <p className="text-4xl font-black text-rose-600 tabular-nums leading-none">{Math.round(current.atl)}</p>
          {(() => {
            const trend = current.atl > current.ctl * 1.15 ? 'up' : current.atl < current.ctl * 0.8 ? 'down' : 'flat'
            const Icon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus
            return <Icon size={16} className={trend === 'up' ? 'text-rose-500' : trend === 'down' ? 'text-emerald-500' : 'text-gray-400'} />
          })()}
        </div>
        <p className="text-xs text-gray-500 leading-snug">{atlContext(current.atl, current.ctl)}</p>
      </div>

      {/* ── TSB tile — col 3, row 2 ───────────────────────────────────── */}
      <div
        className={clsx(
          'rounded-2xl p-5 border',
          tsbPositive ? 'border-emerald-100 bg-emerald-50' : 'border-amber-100 bg-amber-50',
        )}
        style={{ gridColumn: '3', gridRow: '2' }}
      >
        <TileLabel color={tsbPositive ? '#059669' : '#D97706'}>Form · TSB</TileLabel>
        <div className="flex items-end gap-2 mb-1">
          <p
            className={clsx('text-4xl font-black tabular-nums leading-none', tsbPositive ? 'text-emerald-600' : 'text-amber-600')}
          >
            {Math.round(current.tsb)}
          </p>
          {tsbPositive
            ? <TrendingUp size={16} className="text-emerald-500" />
            : <TrendingDown size={16} className="text-amber-500" />
          }
        </div>
        <p className="text-xs text-gray-500 leading-snug">{tsbContext(current.tsb)}</p>
      </div>

      {/* ── CHART tile — cols 1-3, row 3 ─────────────────────────────── */}
      <div
        className="rounded-2xl p-5 border border-gray-200 bg-white"
        style={{ gridColumn: '1 / 4', gridRow: '3', alignSelf: 'start' }}
      >
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">90-Day Training Load</p>
        {fitness && fitness.series.length > 0
          ? <FitnessChart data={fitness.series} />
          : <p className="text-sm text-gray-400 py-8 text-center">No fitness data yet.</p>
        }
      </div>

      {/* ── ACTIVITIES tile — col 4, rows 3-4 ────────────────────────── */}
      <div
        className="rounded-2xl p-5 border border-gray-200 bg-white overflow-hidden flex flex-col"
        style={{ gridColumn: '4', gridRow: '3 / 5' }}
      >
        <TileLabel color="#374151">Activities</TileLabel>
        <div className="flex-1 overflow-y-auto">
          <ActivityFeed activities={activities} />
        </div>
      </div>

      {/* ── THIS WEEK tile — cols 1-3, row 4 ─────────────────────────── */}
      <div
        className="rounded-2xl p-5 border border-gray-200 bg-white"
        style={{ gridColumn: '1 / 4', gridRow: '4', alignSelf: 'start' }}
      >
        <div className="flex items-center justify-between mb-3">
          <TileLabel color="#374151">This Week</TileLabel>
          <a
            href="/plan"
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors"
          >
            Full plan <ChevronRight size={12} />
          </a>
        </div>

        {plan ? (
          <>
            <div className="flex gap-2 flex-wrap">
              {plan.workouts.map((w: PlannedWorkout) => {
                const isToday = w.day_of_week === todayDow
                return (
                  <div
                    key={w.id}
                    className={clsx(
                      'rounded-xl px-3 py-2 flex flex-col items-center gap-0.5 min-w-[60px] transition-all',
                      isToday
                        ? 'bg-indigo-600 text-white'
                        : w.is_completed
                          ? 'bg-gray-100 text-gray-400'
                          : 'bg-gray-50 border border-gray-200 text-gray-700',
                    )}
                  >
                    <span className={clsx('text-[10px] font-semibold uppercase tracking-wide', isToday ? 'text-indigo-200' : 'text-gray-400')}>
                      {DAY_LABELS[w.day_of_week]}
                    </span>
                    <span className="text-lg leading-none">{SPORT_ICONS[w.sport] ?? '🏋️'}</span>
                    <span className={clsx('text-[10px] font-medium', isToday ? 'text-white' : w.is_completed ? 'line-through text-gray-400' : 'text-gray-600')}>
                      {TYPE_ABBREV[w.workout_type] ?? w.workout_type}
                    </span>
                    {w.is_completed && !isToday && <span className="text-[9px] text-emerald-500">✓</span>}
                  </div>
                )
              })}
            </div>
            {plan.narrative && (
              <div className="mt-3 bg-indigo-50 rounded-xl p-3 border border-indigo-100">
                <p className="text-[10px] text-indigo-500 font-semibold uppercase tracking-wider mb-1">Coach's Note</p>
                <p className="text-xs text-gray-600 leading-relaxed">{plan.narrative}</p>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-6">
            <p className="text-gray-400 text-sm mb-2">No plan for this week yet.</p>
            <a
              href="/plan"
              className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 text-sm font-medium transition-colors"
            >
              Generate this week's plan <ChevronRight size={14} />
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
