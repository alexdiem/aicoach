import { useEffect, useState } from 'react'
import { getAthleteId, getActivities, getFitnessMetrics, getCurrentPlan, markWorkoutComplete } from '../api/client'
import ActivityFeed from '../components/ActivityFeed'
import TrainNow from '../components/TrainNow'
import type { Activity, FitnessMetrics, PlannedWorkout, WeeklyPlan } from '../types'

// ─── Arc Gauge ────────────────────────────────────────────────────────────────

function ArcGauge({ value, max, color, size = 160, label }: {
  value: number
  max: number
  color: string
  size?: number
  label: string
}) {
  const pct = Math.min(1, value / max)
  const r = size * 0.38
  const cx = size / 2
  const cy = size * 0.55
  const circumference = Math.PI * r
  const fillLength = pct * circumference
  const trackPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`
  // Needle: angle from π (left) to 0 (right) as value increases
  const needleAngle = Math.PI - pct * Math.PI
  const nx = cx + r * Math.cos(needleAngle)
  const ny = cy - r * Math.sin(needleAngle)
  const svgH = size * 0.6

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={svgH} viewBox={`0 0 ${size} ${svgH}`}>
        {/* Track */}
        <path d={trackPath} fill="none" stroke="#1E1E2E" strokeWidth="8" strokeLinecap="round" />
        {/* Fill */}
        <path
          d={trackPath}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${fillLength} ${circumference}`}
        />
        {/* Needle line from center to arc */}
        <line
          x1={cx}
          y1={cy}
          x2={nx}
          y2={ny}
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.8"
        />
        {/* Needle tip dot */}
        <circle cx={nx} cy={ny} r="4" fill={color} />
        {/* Center dot */}
        <circle cx={cx} cy={cy} r="3" fill="#333" />
      </svg>
      <span className="text-2xl font-bold tabular-nums" style={{ color, fontFamily: 'monospace' }}>
        {Math.round(value)}
      </span>
      <span className="text-xs text-zinc-500 uppercase tracking-wider">{label}</span>
    </div>
  )
}

// ─── TSB Balance Bar ──────────────────────────────────────────────────────────

function BalanceBar({ tsb }: { tsb: number }) {
  const clamped = Math.max(-30, Math.min(30, tsb))
  const pct = ((clamped + 30) / 60) * 100
  const isPositive = tsb >= 0
  return (
    <div>
      <div className="relative h-3 rounded-full overflow-hidden" style={{ backgroundColor: '#1E1E2E' }}>
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-zinc-600" />
        {isPositive ? (
          <div
            className="absolute left-1/2 top-0 h-full rounded-full"
            style={{ width: `${pct / 2}%`, backgroundColor: '#10b981' }}
          />
        ) : (
          <div
            className="absolute top-0 h-full rounded-full"
            style={{ right: '50%', width: `${50 - pct / 2}%`, backgroundColor: '#F43F5E' }}
          />
        )}
      </div>
      <div className="flex justify-between text-xs text-zinc-600 mt-1">
        <span>Fatigued</span>
        <span className="text-zinc-400">TSB {Math.round(tsb)}</span>
        <span>Fresh</span>
      </div>
    </div>
  )
}

// ─── Week Strip ───────────────────────────────────────────────────────────────

const SPORT_COLORS: Record<string, string> = {
  CYCLING:   '#F59E0B',
  RUNNING:   '#06B6D4',
  XC_SKIING: '#818CF8',
  STRENGTH:  '#A78BFA',
}

const SPORT_ICONS: Record<string, string> = {
  CYCLING: '🚴',
  RUNNING: '🏃',
  XC_SKIING: '⛷️',
  STRENGTH: '💪',
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function WeekStrip({
  workouts,
  todayDow,
  onMarkComplete,
}: {
  workouts: PlannedWorkout[]
  todayDow: number
  onMarkComplete: (w: PlannedWorkout) => void
}) {
  return (
    <div className="flex gap-2">
      {DAY_LABELS.map((day, i) => {
        const workout = workouts.find((w) => w.day_of_week === i)
        const isToday = i === todayDow
        const color = workout ? (SPORT_COLORS[workout.sport] ?? '#6B7280') : undefined

        return (
          <div
            key={i}
            onClick={workout && !workout.is_completed ? () => onMarkComplete(workout) : undefined}
            className="flex flex-col items-center gap-1"
            style={{ cursor: workout && !workout.is_completed ? 'pointer' : 'default' }}
          >
            <div
              className="w-9 h-14 rounded flex flex-col items-center justify-center border text-base transition-all"
              style={{
                borderColor: isToday ? '#F59E0B' : workout ? (color + '55') : '#27272a',
                backgroundColor: workout
                  ? (workout.is_completed ? color + '22' : color + '33')
                  : '#12121A',
                opacity: workout?.is_completed ? 0.5 : 1,
              }}
            >
              {workout ? (
                <>
                  <span className="text-sm">{SPORT_ICONS[workout.sport] ?? '🏋️'}</span>
                  {workout.is_completed && (
                    <span className="text-emerald-400 font-bold" style={{ fontSize: '8px', marginTop: '2px' }}>✓</span>
                  )}
                </>
              ) : (
                <span className="text-zinc-700 text-xs">—</span>
              )}
            </div>
            <span
              className="text-[10px] uppercase tracking-wide"
              style={{ color: isToday ? '#F59E0B' : '#52525b' }}
            >
              {day}
            </span>
            {workout && (
              <span className="text-zinc-600" style={{ fontSize: '9px' }}>{workout.duration_minutes}m</span>
            )}
          </div>
        )
      })}
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
      <div className="flex items-center justify-center h-64 text-zinc-500 text-sm tracking-widest uppercase">
        Initialising…
      </div>
    )
  }

  const current = fitness?.current ?? { ctl: 0, atl: 0, tsb: 0 }
  const readiness = fitness?.readiness

  return (
    <div className="flex flex-col gap-6">
      {/* ── Row 1: Instrument panel — 3 gauges ── */}
      <div
        className="rounded-2xl border border-zinc-800 p-6"
        style={{ backgroundColor: '#12121A' }}
      >
        <div className="flex items-start justify-around">
          {/* CTL gauge */}
          <ArcGauge
            value={current.ctl}
            max={150}
            color="#F59E0B"
            size={160}
            label="CTL — Fitness"
          />

          {/* Readiness gauge — larger, center */}
          <div className="flex flex-col items-center gap-2">
            <ArcGauge
              value={readiness?.score ?? 0}
              max={100}
              color="#06B6D4"
              size={220}
              label="Readiness"
            />
            {readiness && (
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#06B6D4' }}>
                {readiness.zone}
              </span>
            )}
          </div>

          {/* ATL gauge */}
          <ArcGauge
            value={current.atl}
            max={150}
            color="#F43F5E"
            size={160}
            label="ATL — Fatigue"
          />
        </div>

        {/* Readiness guidance */}
        {readiness?.guidance && (
          <p className="text-center text-xs text-zinc-500 mt-4 max-w-lg mx-auto leading-relaxed">
            {readiness.guidance}
          </p>
        )}
      </div>

      {/* ── Row 2: TSB + Train Now  |  Week strip ── */}
      <div className="grid grid-cols-2 gap-4">
        {/* Left: TSB balance + Train Now */}
        <div
          className="rounded-2xl border border-zinc-800 p-5 flex flex-col gap-5"
          style={{ backgroundColor: '#12121A' }}
        >
          <div>
            <p className="text-zinc-600 uppercase tracking-widest mb-3" style={{ fontSize: '10px' }}>Form · TSB</p>
            <BalanceBar tsb={current.tsb} />
            <p className="text-xs text-zinc-500 mt-2 leading-relaxed">{tsbContext(current.tsb)}</p>
          </div>
          <TrainNow athleteId={athleteId} />
        </div>

        {/* Right: Week strip */}
        <div
          className="rounded-2xl border border-zinc-800 p-5"
          style={{ backgroundColor: '#12121A' }}
        >
          <p className="text-zinc-600 uppercase tracking-widest mb-4" style={{ fontSize: '10px' }}>This Week</p>
          {plan ? (
            <WeekStrip
              workouts={plan.workouts}
              todayDow={todayDow}
              onMarkComplete={handleMarkComplete}
            />
          ) : (
            <div className="flex items-center justify-center h-24">
              <a href="/plan" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                No plan yet — generate one →
              </a>
            </div>
          )}
          {plan?.narrative && (
            <p className="text-xs text-zinc-500 mt-4 leading-relaxed border-t border-zinc-800 pt-4">
              {plan.narrative}
            </p>
          )}
        </div>
      </div>

      {/* ── Activity Feed ── */}
      <div
        className="rounded-2xl border border-zinc-800 p-5"
        style={{ backgroundColor: '#12121A' }}
      >
        <p className="text-zinc-600 uppercase tracking-widest mb-4" style={{ fontSize: '10px' }}>Recent Activities</p>
        <ActivityFeed activities={activities} />
      </div>
    </div>
  )
}
