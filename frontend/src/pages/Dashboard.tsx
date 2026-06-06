import { useEffect, useState } from 'react'
import { TrendingUp, Zap, Wind, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { getAthleteId, getActivities, getFitnessMetrics, getCurrentPlan, markWorkoutComplete } from '../api/client'
import FitnessChart from '../components/FitnessChart'
import ActivityFeed from '../components/ActivityFeed'
import WorkoutCard from '../components/WorkoutCard'
import type { Activity, FitnessMetrics, PlannedWorkout, WeeklyPlan } from '../types'

function MetricCard({
  label,
  value,
  subtext,
  icon: Icon,
  color,
}: {
  label: string
  value: number
  subtext?: string
  icon: React.ElementType
  color: string
}) {
  return (
    <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{label}</span>
        <div className={clsx('w-7 h-7 rounded-lg flex items-center justify-center', color)}>
          <Icon size={13} className="text-white" />
        </div>
      </div>
      <p className="text-3xl font-bold text-white tabular-nums">{Math.round(value)}</p>
      {subtext && <p className="text-xs text-zinc-500 mt-1">{subtext}</p>}
    </div>
  )
}

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
      <div className="flex items-center justify-center h-64 text-zinc-500 text-sm">Loading…</div>
    )
  }

  const current = fitness?.current ?? { ctl: 0, atl: 0, tsb: 0 }

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
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-500">{Math.round(fitness.season_confidence * 100)}% conf</span>
          </div>
        )}
      </div>

      {/* Fitness metrics */}
      <div className="grid grid-cols-3 gap-4">
        <MetricCard
          label="CTL — Fitness"
          value={current.ctl}
          subtext="Chronic training load"
          icon={TrendingUp}
          color="bg-blue-600"
        />
        <MetricCard
          label="ATL — Fatigue"
          value={current.atl}
          subtext="Acute training load"
          icon={Zap}
          color="bg-rose-600"
        />
        <MetricCard
          label="TSB — Form"
          value={current.tsb}
          subtext={current.tsb >= 5 ? 'Fresh and ready' : current.tsb >= -10 ? 'Neutral' : 'Carrying fatigue'}
          icon={Wind}
          color={current.tsb >= 0 ? 'bg-emerald-600' : 'bg-amber-600'}
        />
      </div>

      {/* Fitness chart */}
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
