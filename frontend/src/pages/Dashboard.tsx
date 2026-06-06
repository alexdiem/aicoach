import { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, Minus, ChevronRight, Moon, Heart, Zap, Battery } from 'lucide-react'
import clsx from 'clsx'
import { getAthleteId, getActivities, getFitnessMetrics, getCurrentPlan, markWorkoutComplete } from '../api/client'
import FitnessChart from '../components/FitnessChart'
import ActivityFeed from '../components/ActivityFeed'
import WorkoutCard from '../components/WorkoutCard'
import TrainNow from '../components/TrainNow'
import type { Activity, FitnessMetrics, PlannedWorkout, WeeklyPlan } from '../types'

// ─── Readiness ring ──────────────────────────────────────────────────────────

function ReadinessRing({ score, zone }: { score: number; zone: string }) {
  const r = 44
  const circ = 2 * Math.PI * r
  const filled = (score / 100) * circ

  const color =
    score >= 80 ? '#22c55e'
    : score >= 60 ? '#3b82f6'
    : score >= 40 ? '#f59e0b'
    : score >= 20 ? '#f97316'
    : '#ef4444'

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-28 h-28">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="#27272a" strokeWidth="10" />
          <circle
            cx="50" cy="50" r={r}
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circ}`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-white tabular-nums">{score}</span>
          <span className="text-[10px] text-zinc-500 uppercase tracking-wide">/ 100</span>
        </div>
      </div>
      <span className="text-sm font-semibold" style={{ color }}>{zone}</span>
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
    <div className="flex items-center gap-2.5 bg-zinc-800/60 rounded-xl px-3 py-2.5">
      <div className={clsx('w-7 h-7 rounded-lg flex items-center justify-center shrink-0',
        good === true ? 'bg-emerald-900/60' : good === false ? 'bg-rose-900/60' : 'bg-zinc-700')}>
        <Icon size={13} className={good === true ? 'text-emerald-400' : good === false ? 'text-rose-400' : 'text-zinc-400'} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</p>
        <p className="text-sm font-semibold text-white leading-tight">{value}</p>
        {sub && <p className="text-[10px] text-zinc-500">{sub}</p>}
      </div>
    </div>
  )
}

// ─── Training load card ───────────────────────────────────────────────────────

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
  const trendColor = trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-rose-400' : 'text-zinc-500'

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500 uppercase tracking-wider">{label}</span>
        {trend && <TrendIcon size={12} className={trendColor} />}
      </div>
      <p className="text-2xl font-bold text-white tabular-nums">{Math.round(value)}</p>
      <p className="text-xs text-zinc-400 leading-snug">{description}</p>
    </div>
  )
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
    return <div className="flex items-center justify-center h-64 text-zinc-500 text-sm">Loading…</div>
  }

  const current = fitness?.current ?? { ctl: 0, atl: 0, tsb: 0 }
  const readiness = fitness?.readiness
  const signals = readiness?.signals ?? {}

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        {fitness && (
          <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-full px-3 py-1.5 text-xs">
            <span className="text-zinc-400">{fitness.season === 'SKI' ? '⛷️' : '🚴'}</span>
            <span className="text-zinc-300 font-medium">
              {fitness.season === 'SKI' ? 'Ski season' : 'Road season'}
            </span>
          </div>
        )}
      </div>

      {/* Readiness + signals */}
      {readiness && (
        <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">Today's Readiness</p>
          <div className="flex gap-6 items-start">
            <ReadinessRing score={readiness.score} zone={readiness.zone} />
            <div className="flex-1 flex flex-col gap-3">
              <p className="text-sm text-zinc-300 leading-relaxed">{readiness.guidance}</p>
              <div className="grid grid-cols-2 gap-2">
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
          </div>
        </div>
      )}

      {/* Train Now */}
      <TrainNow athleteId={athleteId} />

      {/* Training load metrics */}
      <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">Training Load</p>
        <div className="grid grid-cols-3 gap-6 divide-x divide-zinc-800">
          <LoadMetric
            label="CTL — Fitness"
            value={current.ctl}
            description={ctlContext(current.ctl)}
            trend={ctlTrend(fitness?.series)}
          />
          <div className="pl-6">
            <LoadMetric
              label="ATL — Fatigue"
              value={current.atl}
              description={atlContext(current.atl, current.ctl)}
              trend={current.atl > current.ctl * 1.15 ? 'up' : current.atl < current.ctl * 0.8 ? 'down' : 'flat'}
            />
          </div>
          <div className="pl-6">
            <LoadMetric
              label="TSB — Form"
              value={current.tsb}
              description={tsbContext(current.tsb)}
              trend={current.tsb >= 0 ? 'up' : 'down'}
            />
          </div>
        </div>
      </div>

      {/* 90-day chart */}
      {fitness && fitness.series.length > 0 && (
        <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-300 mb-5">90-Day Training Load</h2>
          <FitnessChart data={fitness.series} />
        </div>
      )}

      {/* This week's plan */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-zinc-300">This Week</h2>
          <a
            href="/plan"
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Full plan <ChevronRight size={12} />
          </a>
        </div>
        {plan ? (
          <div className="flex gap-3 overflow-x-auto pb-2">
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
          <div className="bg-zinc-900 rounded-2xl p-8 border border-zinc-800 text-center">
            <p className="text-zinc-500 text-sm mb-3">No plan for this week yet.</p>
            <a
              href="/plan"
              className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 text-sm font-medium transition-colors"
            >
              Generate this week's plan <ChevronRight size={14} />
            </a>
          </div>
        )}
        {plan?.narrative && (
          <div className="mt-3 bg-zinc-900 rounded-2xl p-4 border border-blue-900/50">
            <p className="text-xs text-blue-400 font-semibold uppercase tracking-wider mb-1.5">Coach's Note</p>
            <p className="text-sm text-zinc-300 leading-relaxed">{plan.narrative}</p>
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-300 mb-4">Recent Activities</h2>
        <ActivityFeed activities={activities} />
      </div>
    </div>
  )
}
