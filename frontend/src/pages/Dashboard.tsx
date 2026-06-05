import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { getAthleteId, getActivities, getFitnessMetrics, getCurrentPlan, markWorkoutComplete } from '../api/client'
import FitnessChart from '../components/FitnessChart'
import ActivityFeed from '../components/ActivityFeed'
import WorkoutCard from '../components/WorkoutCard'
import type { Activity, FitnessMetrics, PlannedWorkout, WeeklyPlan } from '../types'

function MetricCard({ label, value, unit, color }: { label: string; value: number; unit?: string; color: string }) {
  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
      <p className="text-xs text-gray-500 font-medium uppercase mb-1">{label}</p>
      <p className={clsx('text-3xl font-bold', color)}>
        {value.toFixed(0)}
        {unit && <span className="text-sm text-gray-500 font-normal ml-1">{unit}</span>}
      </p>
    </div>
  )
}

export default function Dashboard() {
  const athleteId = getAthleteId()!
  const [fitness, setFitness] = useState<FitnessMetrics | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [plan, setPlan] = useState<WeeklyPlan | null>(null)
  const [loading, setLoading] = useState(true)

  const todayDow = (new Date().getDay() + 6) % 7 // 0=Monday

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
      <div className="flex items-center justify-center h-64 text-gray-500">Loading…</div>
    )
  }

  const current = fitness?.current ?? { ctl: 0, atl: 0, tsb: 0 }

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        {fitness && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Season:</span>
            <span className="text-sm font-semibold text-blue-400">
              {fitness.season === 'SKI' ? '⛷️ Ski' : '🚴 Cycling / 🏃 Running'}
            </span>
            <span className="text-xs text-gray-600">({Math.round(fitness.season_confidence * 100)}% conf.)</span>
          </div>
        )}
      </div>

      {/* Fitness metrics */}
      <div className="grid grid-cols-3 gap-4">
        <MetricCard label="CTL — Fitness" value={current.ctl} color="text-blue-400" />
        <MetricCard label="ATL — Fatigue" value={current.atl} color="text-red-400" />
        <MetricCard
          label="TSB — Form"
          value={current.tsb}
          color={current.tsb >= 0 ? 'text-green-400' : 'text-orange-400'}
        />
      </div>

      {/* Fitness chart */}
      {fitness && fitness.series.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">90-Day Fitness Load</h2>
          <FitnessChart data={fitness.series} />
        </div>
      )}

      {/* This week's plan */}
      <div>
        <h2 className="text-sm font-semibold text-gray-300 mb-3">This Week</h2>
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
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 text-center">
            <p className="text-gray-500 mb-3">No plan generated yet.</p>
            <a href="/plan" className="text-blue-400 hover:text-blue-300 text-sm">
              Generate this week's plan →
            </a>
          </div>
        )}
        {plan?.narrative && (
          <div className="mt-3 bg-gray-900 rounded-xl p-4 border border-gray-800">
            <p className="text-xs text-gray-500 font-medium mb-1">Coach's note</p>
            <p className="text-sm text-gray-300 italic">{plan.narrative}</p>
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
        <h2 className="text-sm font-semibold text-gray-300 mb-3">Recent Activities</h2>
        <ActivityFeed activities={activities} />
      </div>
    </div>
  )
}
