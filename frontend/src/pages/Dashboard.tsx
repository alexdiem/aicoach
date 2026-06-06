import { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, Minus, Moon, Heart, Zap, Battery } from 'lucide-react'
import { getAthleteId, getActivities, getFitnessMetrics, getCurrentPlan, markWorkoutComplete } from '../api/client'
import FitnessChart from '../components/FitnessChart'
import ActivityFeed from '../components/ActivityFeed'
import TrainNow from '../components/TrainNow'
import type { Activity, FitnessMetrics, PlannedWorkout, WeeklyPlan } from '../types'

// ─── TSS estimation ────────────────────────────────────────────────────────────

const INTENSITY_FACTORS: Record<string, number> = {
  EASY: 0.6,
  TEMPO: 0.8,
  THRESHOLD: 1.0,
  VO2MAX: 1.1,
  RECOVERY: 0.5,
  LONG: 0.65,
  STRENGTH: 0.5,
}

function estimateTSS(workout: PlannedWorkout): number {
  const if_ = INTENSITY_FACTORS[workout.workout_type] ?? 0.7
  return if_ * (workout.duration_minutes / 60) * 50
}

function sportColor(sport: string): string {
  if (sport === 'CYCLING') return '#F59E0B'
  if (sport === 'RUNNING') return '#38BDF8'
  if (sport === 'XC_SKIING') return '#93C5FD'
  return '#8C7B6B'
}

const SPORT_EMOJI: Record<string, string> = {
  CYCLING: '🚴',
  RUNNING: '🏃',
  XC_SKIING: '⛷️',
  STRENGTH: '💪',
}

const TYPE_ABBREV: Record<string, string> = {
  EASY: 'E',
  TEMPO: 'T',
  THRESHOLD: 'TH',
  VO2MAX: 'V',
  RECOVERY: 'R',
  LONG: 'L',
  STRENGTH: 'S',
}

const DAY_NAMES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

// ─── Day Column ────────────────────────────────────────────────────────────────

interface DayColumnProps {
  dayIndex: number
  date: Date
  workout?: PlannedWorkout
  maxTss: number
  isToday: boolean
}

function DayColumn({ dayIndex, date, workout, maxTss, isToday }: DayColumnProps) {
  const tss = workout ? estimateTSS(workout) : 0
  const barHeightPct = workout && maxTss > 0 ? Math.max(8, (tss / maxTss) * 100) : 0
  const color = workout ? sportColor(workout.sport) : '#332820'

  return (
    <div
      className="flex flex-col items-center gap-1 p-2 rounded-xl cursor-pointer transition-all"
      style={{
        border: isToday ? '1px solid rgba(245,158,11,0.4)' : '1px solid transparent',
        backgroundColor: isToday ? '#2A2010' : 'transparent',
      }}
      onMouseEnter={(e) => {
        if (!isToday) (e.currentTarget as HTMLElement).style.borderColor = '#332820'
      }}
      onMouseLeave={(e) => {
        if (!isToday) (e.currentTarget as HTMLElement).style.borderColor = 'transparent'
      }}
    >
      <span className="text-[10px] uppercase tracking-wider" style={{ color: '#8C7B6B' }}>
        {DAY_NAMES[dayIndex]}
      </span>
      <span className="text-sm font-bold" style={{ color: isToday ? '#F59E0B' : '#F5F0E8' }}>
        {date.getDate()}
      </span>

      {/* Bar container */}
      <div className="w-full h-20 flex flex-col justify-end">
        {workout ? (
          <div
            className="w-full rounded-sm"
            style={{
              height: `${barHeightPct}%`,
              backgroundColor: color,
              opacity: workout.is_completed ? 0.5 : 1,
            }}
          />
        ) : (
          <div className="w-full h-2 rounded" style={{ backgroundColor: '#332820' }} />
        )}
      </div>

      {workout && (
        <span className="text-sm leading-none">{SPORT_EMOJI[workout.sport] ?? '🏋️'}</span>
      )}

      {workout && (
        <span
          className="text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded"
          style={{ color: '#1A1410', backgroundColor: color }}
        >
          {TYPE_ABBREV[workout.workout_type] ?? workout.workout_type.slice(0, 2)}
        </span>
      )}

      {workout?.is_completed && (
        <span className="text-[10px]" style={{ color: '#4ADE80' }}>✓</span>
      )}
    </div>
  )
}

// ─── Week Grid ─────────────────────────────────────────────────────────────────

function WeekGridWithCtl({ plan, todayDow, ctl }: { plan: WeeklyPlan | null; todayDow: number; ctl: number }) {
  const now = new Date()
  const dayOfWeek = (now.getDay() + 6) % 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - dayOfWeek)

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })

  const workoutByDay = new Map<number, PlannedWorkout>()
  plan?.workouts.forEach((w) => workoutByDay.set(w.day_of_week, w))

  const tssList = plan?.workouts.map(estimateTSS) ?? []
  const maxTss = tssList.length > 0 ? Math.max(...tssList) : 1
  const totalTss = Math.round(tssList.reduce((a, b) => a + b, 0))

  const weekLabel = monday
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    .toUpperCase()

  return (
    <div className="rounded-2xl p-5" style={{ backgroundColor: '#221C17', border: '1px solid #332820' }}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#8C7B6B' }}>
          Week of {weekLabel}
        </span>
        {plan && (
          <span
            className="text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-full"
            style={{
              backgroundColor: 'rgba(245,158,11,0.15)',
              color: '#F59E0B',
              border: '1px solid rgba(245,158,11,0.3)',
            }}
          >
            {plan.phase} Phase
          </span>
        )}
      </div>

      <div className="relative grid grid-cols-7 gap-2">
        {days.map((date, i) => (
          <DayColumn
            key={i}
            dayIndex={i}
            date={date}
            workout={workoutByDay.get(i)}
            maxTss={maxTss}
            isToday={i === todayDow}
          />
        ))}

        {!plan && (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-xl"
            style={{ backgroundColor: 'rgba(26,20,16,0.75)' }}
          >
            <a href="/plan" className="text-sm font-medium" style={{ color: '#F59E0B' }}>
              Generate plan to see your week →
            </a>
          </div>
        )}
      </div>

      {plan && (
        <div className="mt-4 pt-4" style={{ borderTop: '1px solid #332820' }}>
          <p className="text-xs" style={{ color: '#8C7B6B' }}>
            Total load:{' '}
            <span style={{ color: '#F5F0E8' }}>{totalTss} TSS</span>
            {ctl > 0 && (
              <>
                {' '}· CTL target: ~
                <span style={{ color: '#F5F0E8' }}>{Math.round(ctl * 7)}</span> TSS/wk
              </>
            )}
          </p>
        </div>
      )}

      {plan?.narrative && (
        <div
          className="mt-3 rounded-xl p-3"
          style={{ backgroundColor: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)' }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: '#F59E0B' }}>
            Coach's Note
          </p>
          <p className="text-xs leading-relaxed" style={{ color: '#8C7B6B' }}>{plan.narrative}</p>
        </div>
      )}
    </div>
  )
}

// ─── Readiness bar ────────────────────────────────────────────────────────────

function ReadinessBar({ score, zone }: { score: number; zone: string }) {
  const zoneColor =
    score >= 80 ? '#4ADE80'
    : score >= 60 ? '#F59E0B'
    : score >= 40 ? '#FB923C'
    : '#F87171'

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#8C7B6B' }}>
          Readiness
        </span>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums" style={{ color: '#F5F0E8' }}>{score}</span>
          <span className="text-sm font-semibold" style={{ color: zoneColor }}>{zone}</span>
        </div>
      </div>
      <div
        className="relative h-3 rounded-full overflow-visible mb-1"
        style={{ background: 'linear-gradient(to right, #F87171, #FB923C, #F59E0B, #4ADE80)' }}
      >
        <div
          className="absolute top-1/2 w-3 h-3 rounded-full border-2 -translate-y-1/2 -translate-x-1/2"
          style={{
            left: `${Math.min(100, Math.max(0, score))}%`,
            borderColor: '#1A1410',
            backgroundColor: zoneColor,
          }}
        />
      </div>
      <div className="flex justify-between text-[9px] uppercase tracking-wider mt-2" style={{ color: '#8C7B6B' }}>
        <span>Low</span>
        <span>Optimal</span>
      </div>
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
  const iconBg =
    good === true ? 'rgba(74,222,128,0.1)'
    : good === false ? 'rgba(248,113,113,0.1)'
    : 'rgba(140,123,107,0.1)'
  const iconColor =
    good === true ? '#4ADE80' : good === false ? '#F87171' : '#8C7B6B'

  return (
    <div
      className="flex items-center gap-2.5 rounded-xl px-3 py-2.5"
      style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
    >
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: iconBg }}
      >
        <Icon size={13} style={{ color: iconColor }} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider" style={{ color: '#8C7B6B' }}>{label}</p>
        <p className="text-sm font-semibold leading-tight" style={{ color: '#F5F0E8' }}>{value}</p>
        {sub && <p className="text-[10px]" style={{ color: '#8C7B6B' }}>{sub}</p>}
      </div>
    </div>
  )
}

// ─── Load metric ──────────────────────────────────────────────────────────────

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
  const trendColor = trend === 'up' ? '#4ADE80' : trend === 'down' ? '#F87171' : '#8C7B6B'

  return (
    <div className="flex flex-col gap-1 pb-3" style={{ borderBottom: '2px solid #F59E0B' }}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: '#8C7B6B' }}>{label}</span>
        {trend && <TrendIcon size={12} style={{ color: trendColor }} />}
      </div>
      <p className="text-2xl font-bold tabular-nums" style={{ color: '#F5F0E8' }}>{Math.round(value)}</p>
      <p className="text-xs leading-snug" style={{ color: '#8C7B6B' }}>{description}</p>
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

  // suppress unused warning — handleMarkComplete is available for future use in day column click
  void handleMarkComplete

  return (
    <div className="flex flex-col gap-8">

      {/* ── Section 1: Week Grid Hero ── */}
      <WeekGridWithCtl plan={plan} todayDow={todayDow} ctl={current.ctl} />

      {/* ── Section 2: Two-column ── */}
      <div className="grid grid-cols-5 gap-6">

        {/* Left col-span-3: Readiness + Training load */}
        <div className="col-span-3 flex flex-col gap-5">

          {readiness && (
            <div className="rounded-2xl p-5" style={{ backgroundColor: '#221C17', border: '1px solid #332820' }}>
              <ReadinessBar score={readiness.score} zone={readiness.zone} />
              {readiness.guidance && (
                <p className="text-xs leading-relaxed mt-3" style={{ color: '#8C7B6B' }}>
                  {readiness.guidance}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 mt-4">
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
                    good={
                      signals.hrv_status.toLowerCase() === 'balanced'
                        ? true
                        : signals.hrv_status.toLowerCase() === 'low'
                          ? false
                          : null
                    }
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
          )}

          <div className="rounded-2xl p-5" style={{ backgroundColor: '#221C17', border: '1px solid #332820' }}>
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-4" style={{ color: '#8C7B6B' }}>
              Training Load
            </p>
            <div className="grid grid-cols-3 gap-6">
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
              <LoadMetric
                label="TSB — Form"
                value={current.tsb}
                description={tsbContext(current.tsb)}
                trend={current.tsb >= 0 ? 'up' : 'down'}
              />
            </div>
          </div>
        </div>

        {/* Right col-span-2: Train Now */}
        <div className="col-span-2">
          <TrainNow athleteId={athleteId} />
        </div>
      </div>

      {/* ── Section 3: 90-day chart ── */}
      {fitness && fitness.series.length > 0 && (
        <div className="rounded-2xl p-5" style={{ backgroundColor: '#221C17', border: '1px solid #332820' }}>
          <h2 className="text-sm font-semibold mb-5" style={{ color: '#F5F0E8' }}>90-Day Training Load</h2>
          <FitnessChart data={fitness.series} />
        </div>
      )}

      {/* ── Activity feed ── */}
      <div className="rounded-2xl p-5" style={{ backgroundColor: '#221C17', border: '1px solid #332820' }}>
        <h2 className="text-sm font-semibold mb-4" style={{ color: '#F5F0E8' }}>Recent Activities</h2>
        <ActivityFeed activities={activities} />
      </div>
    </div>
  )
}
