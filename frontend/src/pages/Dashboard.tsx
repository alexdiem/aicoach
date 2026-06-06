import { useEffect, useState } from 'react'
import { getAthleteId, getActivities, getFitnessMetrics, getCurrentPlan, markWorkoutComplete } from '../api/client'
import FitnessChart from '../components/FitnessChart'
import ActivityFeed from '../components/ActivityFeed'
import WorkoutCard from '../components/WorkoutCard'
import TrainNow from '../components/TrainNow'
import type { Activity, FitnessMetrics, PlannedWorkout, WeeklyPlan } from '../types'

// ─── Section divider ──────────────────────────────────────────────────────────

function SectionDivider() {
  return <hr className="mt-12 mb-8 border-0 h-px" style={{ backgroundColor: '#D62828' }} />
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs tracking-[0.2em] uppercase mb-2 font-normal" style={{ color: '#D62828' }}>
      {children}
    </p>
  )
}

// ─── Training load row ────────────────────────────────────────────────────────

function LoadRow({
  label,
  value,
  description,
}: {
  label: string
  value: number
  description: string
}) {
  return (
    <div className="flex items-baseline gap-6 py-4 border-b border-gray-200 last:border-b-0">
      <span className="text-xs tracking-widest uppercase w-32 shrink-0" style={{ color: '#8C7B6B' }}>
        {label}
      </span>
      <span className="text-5xl font-black tabular-nums leading-none w-24 shrink-0" style={{ color: '#1A1A1A' }}>
        {Math.round(value)}
      </span>
      <span className="text-sm leading-snug" style={{ color: '#8C7B6B' }}>
        {description}
      </span>
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
      <div className="flex items-center justify-center h-64 text-sm" style={{ color: '#8C7B6B' }}>
        Loading…
      </div>
    )
  }

  const current = fitness?.current ?? { ctl: 0, atl: 0, tsb: 0 }
  const readiness = fitness?.readiness
  const signals = readiness?.signals ?? {}

  // Build inline signals string
  const signalParts: string[] = []
  if (signals.sleep_score != null) signalParts.push(`Sleep ${signals.sleep_score}`)
  if (signals.hrv_status) signalParts.push(`HRV ${signals.hrv_status.toLowerCase()}`)
  if (signals.body_battery != null) signalParts.push(`Battery ${signals.body_battery}%`)
  if (signals.resting_hr != null) signalParts.push(`RHR ${Math.round(signals.resting_hr)} bpm`)

  const today = new Date()

  // suppress unused warning — kept for potential future use
  void ctlTrend(fitness?.series)

  return (
    <div>
      {/* Date headline */}
      <p className="serif italic text-sm mb-1" style={{ color: '#8C7B6B' }}>
        {fitness?.season === 'SKI' ? 'Ski season' : 'Road season'}
      </p>
      <h1 className="serif text-6xl font-black tracking-tight leading-none mb-6" style={{ color: '#1A1A1A' }}>
        {today.toLocaleDateString('en-GB', { weekday: 'long' })}
        <span className="text-2xl font-normal ml-3" style={{ color: '#8C7B6B' }}>
          {today.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}
        </span>
      </h1>

      {/* Readiness */}
      {readiness && (
        <>
          <SectionLabel>Readiness</SectionLabel>
          <div className="flex gap-8 items-start">
            <div>
              <span className="text-9xl font-black leading-none tabular-nums" style={{ color: '#1A1A1A' }}>
                {readiness.score}
              </span>
            </div>
            <div className="flex-1 pt-2">
              <p className="text-sm font-bold mb-2" style={{ color: '#1A1A1A' }}>
                {readiness.zone}
              </p>
              <p className="text-sm leading-relaxed mb-3" style={{ color: '#8C7B6B' }}>
                {readiness.guidance}
              </p>
              {signalParts.length > 0 && (
                <p className="text-xs" style={{ color: '#8C7B6B' }}>
                  {signalParts.join(' · ')}
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {/* Training load */}
      <SectionDivider />
      <SectionLabel>Training Load</SectionLabel>
      <div>
        <LoadRow
          label="CTL — Fitness"
          value={current.ctl}
          description={ctlContext(current.ctl)}
        />
        <LoadRow
          label="ATL — Fatigue"
          value={current.atl}
          description={atlContext(current.atl, current.ctl)}
        />
        <LoadRow
          label="TSB — Form"
          value={current.tsb}
          description={tsbContext(current.tsb)}
        />
      </div>

      {/* Train Now */}
      <SectionDivider />
      <TrainNow athleteId={athleteId} />

      {/* 90-day chart */}
      {fitness && fitness.series.length > 0 && (
        <>
          <SectionDivider />
          <SectionLabel>90-Day Training Load</SectionLabel>
          <FitnessChart data={fitness.series} />
        </>
      )}

      {/* This week */}
      <SectionDivider />
      <SectionLabel>This Week</SectionLabel>
      {plan ? (
        <>
          <div className="flex flex-col">
            {plan.workouts.map((w, i) => (
              <WorkoutCard
                key={w.id}
                workout={w}
                isToday={w.day_of_week === todayDow}
                index={i}
                onMarkComplete={handleMarkComplete}
              />
            ))}
          </div>
          {plan.narrative && (
            <div className="mt-6">
              <p className="text-xs tracking-[0.2em] uppercase mb-2" style={{ color: '#8C7B6B' }}>
                Coach's Note
              </p>
              <p className="text-sm leading-relaxed" style={{ color: '#8C7B6B' }}>
                {plan.narrative}
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="py-4">
          <p className="text-sm mb-2" style={{ color: '#8C7B6B' }}>No plan for this week yet.</p>
          <a
            href="/plan"
            className="text-sm underline underline-offset-4"
            style={{ color: '#1A1A1A' }}
          >
            Generate this week's plan →
          </a>
        </div>
      )}

      {/* Recent activity */}
      <SectionDivider />
      <SectionLabel>Recent Activities</SectionLabel>
      <ActivityFeed activities={activities} />
    </div>
  )
}
