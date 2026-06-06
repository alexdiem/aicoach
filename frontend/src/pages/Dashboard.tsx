import { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, Minus, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { getAthleteId, getActivities, getFitnessMetrics, getCurrentPlan, markWorkoutComplete } from '../api/client'
import FitnessChart from '../components/FitnessChart'
import ActivityFeed from '../components/ActivityFeed'
import WorkoutCard from '../components/WorkoutCard'
import TrainNow from '../components/TrainNow'
import type { Activity, FitnessMetrics, PlannedWorkout, WeeklyPlan } from '../types'

// ─── Readiness bar ──────────────────────────────────────────────────────────

function ReadinessBar({ score, zone }: { score: number; zone: string }) {
  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-baseline justify-between">
        <span className="text-4xl font-bold text-lime-400 font-mono tabular-nums">{score}</span>
        <span className="text-xs text-lime-400/50 font-mono uppercase tracking-widest">{zone}</span>
      </div>
      <div className="w-full bg-black border border-lime-400/40 h-2.5">
        <div className="h-full bg-lime-400" style={{ width: score + '%' }} />
      </div>
      <span className="text-[10px] text-lime-400/40 font-mono">READINESS / 100</span>
    </div>
  )
}

// ─── Signal rows ─────────────────────────────────────────────────────────────

function SignalRow({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-lime-400/10 last:border-0">
      <span className="text-[10px] text-lime-400/50 font-mono uppercase tracking-widest">{label}</span>
      <span className="text-sm text-lime-400 font-mono font-semibold tabular-nums">
        {value}{sub ? <span className="text-lime-400/40 text-xs ml-1">{sub}</span> : null}
      </span>
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
  const trendColor = trend === 'up' ? 'text-lime-400' : trend === 'down' ? 'text-lime-400/40' : 'text-lime-400/30'

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-lime-400/50 font-mono uppercase tracking-widest">{label}</span>
        {trend && <TrendIcon size={12} className={trendColor} />}
      </div>
      <p className="text-3xl font-bold text-lime-400 font-mono tabular-nums">{Math.round(value)}</p>
      <p className="text-[10px] text-lime-400/40 font-mono leading-snug">{description}</p>
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
    return (
      <div className="flex items-center justify-center h-64 font-mono text-lime-400/50 text-sm">
        LOADING...
      </div>
    )
  }

  const current = fitness?.current ?? { ctl: 0, atl: 0, tsb: 0 }
  const readiness = fitness?.readiness
  const signals = readiness?.signals ?? {}

  return (
    <div className="flex flex-col gap-6 font-mono">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-lime-400/20 pb-4">
        <div>
          <h1 className="text-sm font-bold text-lime-400 font-mono uppercase tracking-widest">DASHBOARD</h1>
          <p className="text-xs text-lime-400/40 font-mono mt-0.5">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}
          </p>
        </div>
        {fitness && (
          <div className="border border-lime-400/30 px-3 py-1.5 text-[10px] font-mono text-lime-400/60 uppercase tracking-widest">
            {fitness.season === 'SKI' ? 'SKI SEASON' : 'ROAD SEASON'}
          </div>
        )}
      </div>

      {/* Readiness + signals */}
      {readiness && (
        <div className="border border-lime-400/20 p-5">
          <p className="font-mono text-lime-400 text-xs mb-4">&gt; READINESS STATUS</p>
          <div className="flex gap-8 items-start">
            <div className="w-48 shrink-0">
              <ReadinessBar score={readiness.score} zone={readiness.zone} />
            </div>
            <div className="flex-1 flex flex-col gap-3">
              <p className="text-xs text-lime-400/60 font-mono leading-relaxed">{readiness.guidance}</p>
              <div className="flex flex-col">
                {signals.body_battery != null && (
                  <SignalRow label="BODY BATTERY" value={`${signals.body_battery}%`} />
                )}
                {signals.hrv_status && (
                  <SignalRow label="HRV STATUS" value={signals.hrv_status.toUpperCase()} />
                )}
                {signals.sleep_score != null && (
                  <SignalRow
                    label="SLEEP SCORE"
                    value={`${signals.sleep_score}`}
                    sub={signals.sleep_hours ? `${signals.sleep_hours}h` : undefined}
                  />
                )}
                {signals.resting_hr != null && (
                  <SignalRow label="RESTING HR" value={`${Math.round(signals.resting_hr)} BPM`} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Train Now */}
      <TrainNow athleteId={athleteId} />

      {/* Training load metrics */}
      <div className="border border-lime-400/20 p-5">
        <p className="font-mono text-lime-400 text-xs mb-4">&gt; TRAINING LOAD</p>
        <div className="grid grid-cols-3 gap-6 divide-x divide-lime-400/20">
          <LoadMetric
            label="CTL — FITNESS"
            value={current.ctl}
            description={ctlContext(current.ctl)}
            trend={ctlTrend(fitness?.series)}
          />
          <div className="pl-6">
            <LoadMetric
              label="ATL — FATIGUE"
              value={current.atl}
              description={atlContext(current.atl, current.ctl)}
              trend={current.atl > current.ctl * 1.15 ? 'up' : current.atl < current.ctl * 0.8 ? 'down' : 'flat'}
            />
          </div>
          <div className="pl-6">
            <LoadMetric
              label="TSB — FORM"
              value={current.tsb}
              description={tsbContext(current.tsb)}
              trend={current.tsb >= 0 ? 'up' : 'down'}
            />
          </div>
        </div>
      </div>

      {/* 90-day chart */}
      {fitness && fitness.series.length > 0 && (
        <div className="border border-lime-400/20 p-5">
          <p className="font-mono text-lime-400 text-xs mb-4">&gt; 90-DAY TRAINING LOAD</p>
          <FitnessChart data={fitness.series} />
        </div>
      )}

      {/* This week's plan */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="font-mono text-lime-400 text-xs">&gt; THIS WEEK</p>
          <a
            href="/plan"
            className="flex items-center gap-1 text-[10px] font-mono text-lime-400/40 hover:text-lime-400 transition-colors uppercase tracking-widest"
          >
            FULL PLAN <ChevronRight size={10} />
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
          <div className="border border-lime-400/20 p-8 text-center">
            <p className="text-lime-400/50 text-xs font-mono mb-3">NO PLAN FOR THIS WEEK YET.</p>
            <a
              href="/plan"
              className={clsx(
                'inline-flex items-center gap-1 text-xs font-mono font-medium transition-colors',
                'text-lime-400 hover:text-black hover:bg-lime-400 px-3 py-1.5',
              )}
            >
              GENERATE THIS WEEK&apos;S PLAN <ChevronRight size={12} />
            </a>
          </div>
        )}
        {plan?.narrative && (
          <div className="mt-3 border border-lime-400/20 p-4">
            <p className="text-[10px] font-mono text-lime-400 uppercase tracking-widest mb-1.5">&gt; COACH&apos;S NOTE</p>
            <p className="text-xs text-lime-400/60 font-mono leading-relaxed">{plan.narrative}</p>
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div className="border border-lime-400/20 p-5">
        <p className="font-mono text-lime-400 text-xs mb-4">&gt; RECENT ACTIVITIES</p>
        <ActivityFeed activities={activities} />
      </div>
    </div>
  )
}
