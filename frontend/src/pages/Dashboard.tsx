import { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, Minus, ChevronRight, Moon, Heart, Zap, Battery } from 'lucide-react'
import clsx from 'clsx'
import { getAthleteId, getActivities, getFitnessMetrics, getCurrentPlan, markWorkoutComplete } from '../api/client'
import FitnessChart from '../components/FitnessChart'
import ActivityFeed from '../components/ActivityFeed'
import WorkoutCard from '../components/WorkoutCard'
import TrainNow from '../components/TrainNow'
import type { Activity, FitnessMetrics, PlannedWorkout, WeeklyPlan } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SPORT_ICONS: Record<string, string> = {
  CYCLING: '🚴',
  RUNNING: '🏃',
  XC_SKIING: '⛷️',
  STRENGTH: '💪',
}

const TYPE_BADGE: Record<string, string> = {
  EASY:      'bg-emerald-950 text-emerald-400',
  RECOVERY:  'bg-zinc-800 text-zinc-400',
  TEMPO:     'bg-yellow-950 text-yellow-400',
  THRESHOLD: 'bg-orange-950 text-orange-400',
  VO2MAX:    'bg-rose-950 text-rose-400',
  LONG:      'bg-blue-950 text-blue-400',
  STRENGTH:  'bg-violet-950 text-violet-400',
}

function readinessColor(score: number): string {
  if (score >= 80) return '#34d399' // emerald-400
  if (score >= 60) return '#7C3AED' // violet
  if (score >= 40) return '#f59e0b'
  if (score >= 20) return '#f97316'
  return '#f43f5e' // rose-400
}

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
  if (ctl >= 80) return "High aerobic base — you're well prepared for demanding events."
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

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={clsx('animate-pulse rounded-lg', className)}
      style={{ backgroundColor: '#1E1E35' }}
    />
  )
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {/* Hero skeleton */}
      <div className="rounded-2xl p-8" style={{ backgroundColor: '#12121F', border: '1px solid #1E1E35' }}>
        <div className="flex gap-8">
          <div className="flex-1 flex flex-col gap-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-4 w-80" />
            <div className="flex gap-4 mt-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
          <div className="w-px" style={{ backgroundColor: '#1E1E35' }} />
          <div className="flex flex-col gap-3" style={{ width: '40%' }}>
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-12 w-12 rounded-xl" />
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
        <Skeleton className="h-1 w-full mt-6 rounded-full" />
      </div>
      {/* Two col skeleton */}
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 flex flex-col gap-4">
          <div className="rounded-2xl p-5" style={{ backgroundColor: '#12121F', border: '1px solid #1E1E35' }}>
            <Skeleton className="h-3 w-28 mb-4" />
            <div className="flex flex-col gap-4">
              {[0,1,2].map(i => <Skeleton key={i} className="h-12" />)}
            </div>
          </div>
          <div className="rounded-2xl p-5" style={{ backgroundColor: '#12121F', border: '1px solid #1E1E35' }}>
            <Skeleton className="h-40 w-full" />
          </div>
        </div>
        <div className="col-span-1 flex flex-col gap-4">
          <div className="rounded-2xl p-4" style={{ backgroundColor: '#12121F', border: '1px solid #1E1E35' }}>
            <Skeleton className="h-3 w-20 mb-4" />
            <Skeleton className="h-24" />
          </div>
          <div className="rounded-2xl p-4" style={{ backgroundColor: '#12121F', border: '1px solid #1E1E35' }}>
            <Skeleton className="h-3 w-20 mb-3" />
            {[0,1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-8 mb-2" />)}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Load metric row ──────────────────────────────────────────────────────────

function LoadMetric({
  label,
  value,
  description,
  trend,
}: {
  label: string
  value: number
  description: string
  trend?: 'up' | 'down' | 'flat'
}) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus
  const trendColor =
    trend === 'up' ? '#34d399' : trend === 'down' ? '#f43f5e' : '#6B6B8A'

  // Bar fill as % of 100 for CTL/ATL, center for TSB
  const pct = Math.min(Math.abs(value) / 100, 1)

  return (
    <div className="flex flex-col gap-1.5 py-3" style={{ borderBottom: '1px solid #1E1E35' }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#6B6B8A' }}>
          {label}
        </span>
        {trend && <TrendIcon size={12} style={{ color: trendColor }} />}
      </div>
      <div className="flex items-baseline gap-3">
        <p className="text-2xl font-bold text-white tabular-nums">{Math.round(value)}</p>
        <p className="text-xs leading-snug" style={{ color: '#6B6B8A' }}>{description}</p>
      </div>
      {/* Mini bar */}
      <div className="h-1 rounded-full" style={{ backgroundColor: '#1E1E35' }}>
        <div
          className="h-1 rounded-full transition-all"
          style={{ width: `${pct * 100}%`, backgroundColor: '#7C3AED' }}
        />
      </div>
    </div>
  )
}

// ─── Signal dot row ────────────────────────────────────────────────────────────

function SignalDot({ color }: { color: string }) {
  return <span className="w-2 h-2 rounded-full shrink-0 inline-block" style={{ backgroundColor: color }} />
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
    return <DashboardSkeleton />
  }

  const current = fitness?.current ?? { ctl: 0, atl: 0, tsb: 0 }
  const readiness = fitness?.readiness
  const signals = readiness?.signals ?? {}

  const todayWorkout = plan?.workouts.find((w) => w.day_of_week === todayDow) ?? null
  const scoreColor = readiness ? readinessColor(readiness.score) : '#7C3AED'
  const scorePct = readiness ? readiness.score / 100 : 0

  // Signal row items
  const signalItems: Array<{ label: string; value: string; icon: React.ElementType; good: boolean | null }> = []
  if (signals.body_battery != null) {
    signalItems.push({
      label: 'Battery',
      value: `${signals.body_battery}%`,
      icon: Battery,
      good: signals.body_battery >= 60 ? true : signals.body_battery < 30 ? false : null,
    })
  }
  if (signals.hrv_status) {
    signalItems.push({
      label: 'HRV',
      value: signals.hrv_status,
      icon: Heart,
      good: signals.hrv_status.toLowerCase() === 'balanced' ? true : signals.hrv_status.toLowerCase() === 'low' ? false : null,
    })
  }
  if (signals.sleep_score != null) {
    signalItems.push({
      label: 'Sleep',
      value: `${signals.sleep_score}${signals.sleep_hours ? ` · ${signals.sleep_hours}h` : ''}`,
      icon: Moon,
      good: signals.sleep_score >= 70 ? true : signals.sleep_score < 50 ? false : null,
    })
  }
  if (signals.resting_hr != null) {
    signalItems.push({
      label: 'Rest HR',
      value: `${Math.round(signals.resting_hr)} bpm`,
      icon: Zap,
      good: null,
    })
  }

  const dateStr = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).toUpperCase()

  return (
    <div className="flex flex-col gap-6">

      {/* ── Zone 1: Hero "Today's Mission" ── */}
      <div className="rounded-2xl p-8" style={{ backgroundColor: '#12121F', border: '1px solid #1E1E35' }}>
        <div className="flex gap-0">

          {/* LEFT 60% */}
          <div className="flex flex-col gap-3" style={{ flex: '0 0 60%' }}>
            <span className="text-sm uppercase tracking-widest" style={{ color: '#6B6B8A' }}>
              {dateStr}
            </span>

            {readiness ? (
              <>
                <h1 className="text-3xl font-black text-white leading-tight">
                  {readiness.zone}
                </h1>
                <p className="text-sm leading-relaxed" style={{ color: '#6B6B8A' }}>
                  {readiness.guidance}
                </p>
                {/* Inline signal row */}
                {signalItems.length > 0 && (
                  <div className="flex items-center gap-5 mt-1 flex-wrap">
                    {signalItems.map((s) => (
                      <div key={s.label} className="flex items-center gap-1.5">
                        <SignalDot
                          color={
                            s.good === true ? '#34d399'
                            : s.good === false ? '#f43f5e'
                            : '#6B6B8A'
                          }
                        />
                        <span className="text-xs" style={{ color: '#6B6B8A' }}>{s.label}</span>
                        <span className="text-xs font-semibold text-white">{s.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <h1 className="text-3xl font-black text-white">Good morning</h1>
            )}
          </div>

          {/* RIGHT 40% */}
          <div
            className="flex flex-col gap-3 pl-8"
            style={{ flex: '0 0 40%', borderLeft: '1px solid #1E1E35' }}
          >
            <span
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: '#7C3AED' }}
            >
              Today's Workout
            </span>

            {todayWorkout ? (
              <>
                <div className="flex items-center gap-3">
                  <span className="text-3xl leading-none">
                    {SPORT_ICONS[todayWorkout.sport] ?? '🏋️'}
                  </span>
                  <span
                    className={clsx(
                      'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                      TYPE_BADGE[todayWorkout.workout_type] ?? 'bg-zinc-800 text-zinc-400',
                    )}
                  >
                    {todayWorkout.workout_type}
                  </span>
                </div>
                <p className="text-sm font-bold text-white">
                  {todayWorkout.duration_minutes}
                  <span className="font-normal text-xs ml-1" style={{ color: '#6B6B8A' }}>min</span>
                </p>
                {todayWorkout.purpose && (
                  <p className="text-xs leading-relaxed" style={{ color: '#6B6B8A' }}>
                    {todayWorkout.purpose}
                  </p>
                )}
                {!todayWorkout.is_completed && (
                  <button
                    onClick={() => handleMarkComplete(todayWorkout)}
                    className="self-start text-xs font-semibold transition-colors"
                    style={{ color: '#A78BFA' }}
                  >
                    Mark complete →
                  </button>
                )}
                {todayWorkout.is_completed && (
                  <span className="self-start text-xs font-semibold text-emerald-400">✓ Done</span>
                )}
              </>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-xs" style={{ color: '#6B6B8A' }}>No workout planned for today.</p>
                <a
                  href="/plan"
                  className="self-start text-xs font-semibold transition-colors"
                  style={{ color: '#A78BFA' }}
                >
                  Generate plan →
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Readiness progress bar */}
        <div className="mt-8 h-1 rounded-full" style={{ backgroundColor: '#1E1E35' }}>
          <div
            className="h-1 rounded-full transition-all duration-700"
            style={{ width: `${scorePct * 100}%`, backgroundColor: scoreColor }}
          />
        </div>
      </div>

      {/* ── Zone 2: Two-column grid ── */}
      <div className="grid grid-cols-3 gap-6">

        {/* Left 2/3 */}
        <div className="col-span-2 flex flex-col gap-6">

          {/* Training load card */}
          <div className="rounded-2xl p-5" style={{ backgroundColor: '#12121F', border: '1px solid #1E1E35' }}>
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: '#6B6B8A' }}>
              Training Load
            </p>
            <LoadMetric
              label="CTL — Fitness"
              value={current.ctl}
              description={ctlContext(current.ctl)}
              trend={ctlTrend(fitness?.series)}
            />
            <LoadMetric
              label="ATL — Fatigue"
              value={current.atl}
              description={atlContext(current.atl, current.ctl)}
              trend={current.atl > current.ctl * 1.15 ? 'up' : current.atl < current.ctl * 0.8 ? 'down' : 'flat'}
            />
            <div style={{ borderBottom: 'none' }}>
              <LoadMetric
                label="TSB — Form"
                value={current.tsb}
                description={tsbContext(current.tsb)}
                trend={current.tsb >= 0 ? 'up' : 'down'}
              />
            </div>
          </div>

          {/* 90-day chart */}
          {fitness && fitness.series.length > 0 && (
            <div className="rounded-2xl p-5" style={{ backgroundColor: '#12121F', border: '1px solid #1E1E35' }}>
              <p className="text-xs font-semibold uppercase tracking-widest mb-5" style={{ color: '#6B6B8A' }}>
                90-Day Training Load
              </p>
              <FitnessChart data={fitness.series} />
            </div>
          )}
        </div>

        {/* Right 1/3 */}
        <div className="col-span-1 flex flex-col gap-6">

          {/* Train Now (compact) */}
          <TrainNow athleteId={athleteId} />

          {/* This week vertical list */}
          <div className="rounded-2xl p-4" style={{ backgroundColor: '#12121F', border: '1px solid #1E1E35' }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#6B6B8A' }}>
                This Week
              </p>
              <a
                href="/plan"
                className="flex items-center gap-0.5 text-xs transition-colors"
                style={{ color: '#6B6B8A' }}
              >
                Full plan <ChevronRight size={11} />
              </a>
            </div>
            {plan ? (
              <div className="flex flex-col gap-0.5">
                {plan.workouts.map((w) => (
                  <WorkoutCard
                    key={w.id}
                    workout={w}
                    isToday={w.day_of_week === todayDow}
                    onMarkComplete={handleMarkComplete}
                  />
                ))}
              </div>
            ) : (
              <div className="py-4 text-center">
                <p className="text-xs mb-2" style={{ color: '#6B6B8A' }}>No plan for this week yet.</p>
                <a
                  href="/plan"
                  className="text-xs font-semibold transition-colors"
                  style={{ color: '#A78BFA' }}
                >
                  Generate plan →
                </a>
              </div>
            )}
            {plan?.narrative && (
              <div className="mt-3 rounded-xl p-3" style={{ backgroundColor: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)' }}>
                <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#7C3AED' }}>
                  Coach's Note
                </p>
                <p className="text-xs leading-relaxed" style={{ color: '#6B6B8A' }}>{plan.narrative}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Zone 3: Activity feed ── */}
      <div className="rounded-2xl p-5" style={{ backgroundColor: '#12121F', border: '1px solid #1E1E35' }}>
        <p className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: '#6B6B8A' }}>
          Recent Activities
        </p>
        <ActivityFeed activities={activities} />
      </div>

    </div>
  )
}
