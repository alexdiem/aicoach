import { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, Minus, Moon, Heart, Zap, Battery, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { getAthleteId, getActivities, getFitnessMetrics, getCurrentPlan, markWorkoutComplete } from '../api/client'
import WorkoutCard from '../components/WorkoutCard'
import TrainNow from '../components/TrainNow'
import ActivityFeed from '../components/ActivityFeed'
import type { Activity, FitnessMetrics, PlannedWorkout, WeeklyPlan } from '../types'

// ─── Coach avatar ─────────────────────────────────────────────────────────────

function CoachAvatar() {
  return (
    <div
      className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold"
      style={{ backgroundColor: '#58A6FF', color: '#0D1117' }}
    >
      AC
    </div>
  )
}

// ─── Chat bubble ──────────────────────────────────────────────────────────────

function CoachBubble({ text }: { text: string }) {
  return (
    <div
      className="rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm max-w-xs"
      style={{ backgroundColor: '#1C2128', color: '#E6EDF3' }}
    >
      {text}
    </div>
  )
}

// ─── Chat turn (bubble + optional card below) ─────────────────────────────────

function ChatTurn({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {/* Avatar + bubble row */}
      <div className="flex items-start gap-2">
        <CoachAvatar />
        <CoachBubble text={text} />
      </div>
      {/* Attached card — indented to align with bubble */}
      {children && (
        <div className="ml-9">
          {children}
        </div>
      )}
    </div>
  )
}

// ─── Readiness card ───────────────────────────────────────────────────────────

function ReadinessCard({ score, zone, guidance }: { score: number; zone: string; guidance: string }) {
  const color =
    score >= 80 ? '#22c55e'
    : score >= 60 ? '#3b82f6'
    : score >= 40 ? '#f59e0b'
    : score >= 20 ? '#f97316'
    : '#ef4444'

  const r = 28
  const circ = 2 * Math.PI * r
  const filled = (score / 100) * circ

  return (
    <div
      className="rounded-xl border p-3 flex items-center gap-3"
      style={{ backgroundColor: '#161B22', borderColor: '#30363D' }}
    >
      {/* Mini ring */}
      <div className="relative w-14 h-14 shrink-0">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r={r} fill="none" stroke="#21262D" strokeWidth="6" />
          <circle
            cx="32" cy="32" r={r}
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circ}`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-sm font-bold tabular-nums" style={{ color: '#E6EDF3' }}>{score}</span>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold mb-0.5" style={{ color }}>
          {zone}
        </p>
        <p className="text-[11px] leading-relaxed" style={{ color: '#8B949E' }}>{guidance}</p>
      </div>
    </div>
  )
}

// ─── Recovery signals card ────────────────────────────────────────────────────

function SignalRow({
  signals,
}: {
  signals: { sleep_score?: number; sleep_hours?: number; hrv_status?: string; body_battery?: number; resting_hr?: number }
}) {
  const items: Array<{ icon: React.ElementType; label: string; value: string; good?: boolean | null }> = []

  if (signals.sleep_score != null)
    items.push({
      icon: Moon,
      label: 'Sleep',
      value: `${signals.sleep_score}${signals.sleep_hours ? ` · ${signals.sleep_hours}h` : ''}`,
      good: signals.sleep_score >= 70 ? true : signals.sleep_score < 50 ? false : null,
    })

  if (signals.hrv_status)
    items.push({
      icon: Heart,
      label: 'HRV',
      value: signals.hrv_status,
      good: signals.hrv_status.toLowerCase() === 'balanced' ? true : signals.hrv_status.toLowerCase() === 'low' ? false : null,
    })

  if (signals.body_battery != null)
    items.push({
      icon: Battery,
      label: 'Battery',
      value: `${signals.body_battery}%`,
      good: signals.body_battery >= 60 ? true : signals.body_battery < 30 ? false : null,
    })

  if (signals.resting_hr != null)
    items.push({ icon: Zap, label: 'RHR', value: `${Math.round(signals.resting_hr)} bpm` })

  if (items.length === 0) return null

  return (
    <div
      className="rounded-xl border p-2.5 flex gap-2"
      style={{ backgroundColor: '#161B22', borderColor: '#30363D' }}
    >
      {items.map(({ icon: Icon, label, value, good }) => (
        <div key={label} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center"
            style={{
              backgroundColor:
                good === true ? 'rgba(34,197,94,0.15)'
                : good === false ? 'rgba(239,68,68,0.15)'
                : '#21262D',
            }}
          >
            <Icon
              size={12}
              className={
                good === true ? 'text-emerald-400'
                : good === false ? 'text-rose-400'
                : 'text-[#8B949E]'
              }
            />
          </div>
          <p className="text-[9px] uppercase tracking-wider text-[#484F58]">{label}</p>
          <p className="text-[11px] font-semibold text-center" style={{ color: '#E6EDF3' }}>{value}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Load card ────────────────────────────────────────────────────────────────

function LoadCard({
  ctl, atl, tsb,
  ctlDesc, atlDesc, tsbDesc,
  ctlTrendDir,
}: {
  ctl: number; atl: number; tsb: number
  ctlDesc: string; atlDesc: string; tsbDesc: string
  ctlTrendDir: 'up' | 'down' | 'flat'
}) {
  const metrics = [
    { label: 'CTL', sub: 'Fitness', value: ctl, desc: ctlDesc, trend: ctlTrendDir },
    { label: 'ATL', sub: 'Fatigue', value: atl, desc: atlDesc, trend: (atl > ctl * 1.15 ? 'up' : atl < ctl * 0.8 ? 'down' : 'flat') as 'up' | 'down' | 'flat' },
    { label: 'TSB', sub: 'Form', value: tsb, desc: tsbDesc, trend: (tsb >= 0 ? 'up' : 'down') as 'up' | 'down' | 'flat' },
  ]

  return (
    <div
      className="rounded-xl border p-3 grid grid-cols-3 divide-x"
      style={{ backgroundColor: '#161B22', borderColor: '#30363D', divideColor: '#30363D' }}
    >
      {metrics.map(({ label, sub, value, trend }, i) => {
        const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus
        const trendColor = trend === 'up' ? '#22c55e' : trend === 'down' ? '#ef4444' : '#484F58'
        return (
          <div key={label} className={clsx('flex flex-col gap-0.5', i > 0 && 'pl-3')} style={i > 0 ? { borderLeft: '1px solid #30363D' } : undefined}>
            <div className="flex items-center justify-between">
              <span className="text-[9px] uppercase tracking-wider text-[#484F58]">{label}</span>
              <TrendIcon size={10} style={{ color: trendColor }} />
            </div>
            <p className="text-lg font-bold tabular-nums" style={{ color: '#E6EDF3' }}>{Math.round(value)}</p>
            <p className="text-[9px] leading-tight" style={{ color: '#8B949E' }}>{sub}</p>
          </div>
        )
      })}
    </div>
  )
}

// ─── Helper fns ───────────────────────────────────────────────────────────────

function tsbContext(tsb: number): string {
  if (tsb >= 10) return 'Fresh and race-ready.'
  if (tsb >= 0) return 'Lightly fresh.'
  if (tsb >= -10) return 'Neutral zone.'
  if (tsb >= -20) return 'Fatigue building.'
  if (tsb >= -30) return 'Meaningful fatigue — protect recovery.'
  return 'Deep fatigue — rest needed.'
}

function atlContext(atl: number, ctl: number): string {
  const ratio = ctl > 0 ? atl / ctl : 1
  if (ratio > 1.4) return 'Load well above baseline — watch it.'
  if (ratio > 1.15) return 'Elevated load — normal in a build block.'
  if (ratio < 0.7) return 'Very light load — recovery or taper.'
  return 'Load proportionate to fitness.'
}

function ctlContext(ctl: number): string {
  if (ctl >= 80) return 'High aerobic base.'
  if (ctl >= 55) return 'Solid competitive fitness.'
  if (ctl >= 35) return 'Moderate base — building steadily.'
  if (ctl >= 15) return 'Early-season range.'
  return 'Low base — build aerobic volume.'
}

function ctlTrend(series: Array<{ ctl: number }> | undefined): 'up' | 'down' | 'flat' {
  if (!series || series.length < 14) return 'flat'
  const recent = series[series.length - 1].ctl
  const twoWeeksAgo = series[series.length - 14].ctl
  const delta = recent - twoWeeksAgo
  return delta > 2 ? 'up' : delta < -2 ? 'down' : 'flat'
}

function recoveryQuality(signals: { sleep_score?: number; hrv_status?: string; body_battery?: number }) {
  let score = 0
  let count = 0
  if (signals.sleep_score != null) { score += signals.sleep_score >= 70 ? 1 : signals.sleep_score < 50 ? -1 : 0; count++ }
  if (signals.hrv_status) { score += signals.hrv_status.toLowerCase() === 'balanced' ? 1 : signals.hrv_status.toLowerCase() === 'low' ? -1 : 0; count++ }
  if (signals.body_battery != null) { score += signals.body_battery >= 60 ? 1 : signals.body_battery < 30 ? -1 : 0; count++ }
  if (count === 0) return 'mixed'
  return score / count > 0.3 ? 'good' : score / count < -0.3 ? 'low' : 'mixed'
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
      <div className="flex items-center justify-center h-40 text-sm text-[#484F58]">
        Loading…
      </div>
    )
  }

  const current = fitness?.current ?? { ctl: 0, atl: 0, tsb: 0 }
  const readiness = fitness?.readiness
  const signals = readiness?.signals ?? {}
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="flex flex-col gap-5 p-4 overflow-y-auto">

      {/* 1 — Greeting + readiness */}
      {readiness ? (
        <ChatTurn text={`${greeting} Alex. Here's your readiness for today.`}>
          <ReadinessCard score={readiness.score} zone={readiness.zone} guidance={readiness.guidance} />
        </ChatTurn>
      ) : (
        <ChatTurn text={`${greeting} Alex. No readiness data yet — sync your device in Settings.`} />
      )}

      {/* 2 — Recovery signals */}
      {readiness && Object.keys(signals).length > 0 && (
        <ChatTurn text={`Your recovery signals look ${recoveryQuality(signals)}.`}>
          <SignalRow signals={signals} />
        </ChatTurn>
      )}

      {/* 3 — Load */}
      <ChatTurn
        text={`Your fitness is at CTL ${Math.round(current.ctl)}. Form is ${tsbContext(current.tsb).toLowerCase()}`}
      >
        <LoadCard
          ctl={current.ctl}
          atl={current.atl}
          tsb={current.tsb}
          ctlDesc={ctlContext(current.ctl)}
          atlDesc={atlContext(current.atl, current.ctl)}
          tsbDesc={tsbContext(current.tsb)}
          ctlTrendDir={ctlTrend(fitness?.series)}
        />
      </ChatTurn>

      {/* 4 — Fitness chart link */}
      {fitness && fitness.series.length > 0 && (
        <ChatTurn text="Tap to see your 90-day training load chart in the detail panel.">
          <a
            href="/plan"
            className="inline-flex items-center gap-1 text-xs font-medium text-[#58A6FF] hover:text-blue-300 transition-colors"
          >
            View fitness chart <ChevronRight size={12} />
          </a>
        </ChatTurn>
      )}

      {/* 5 — Plan */}
      <ChatTurn
        text={
          plan
            ? `This week you have ${plan.workouts.length} session${plan.workouts.length !== 1 ? 's' : ''} planned.`
            : "No plan for this week yet. Head to Plan to generate one."
        }
      >
        {plan ? (
          <div
            className="rounded-xl border overflow-x-auto"
            style={{ backgroundColor: '#161B22', borderColor: '#30363D' }}
          >
            <div className="flex gap-2 p-2.5">
              {plan.workouts.map((w) => (
                <WorkoutCard
                  key={w.id}
                  workout={w}
                  compact
                  isToday={w.day_of_week === todayDow}
                  onMarkComplete={handleMarkComplete}
                />
              ))}
            </div>
            {plan.narrative && (
              <div className="px-2.5 pb-2.5" style={{ borderTop: '1px solid #30363D', paddingTop: '8px' }}>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: '#58A6FF' }}>Coach's note</p>
                <p className="text-[11px] leading-relaxed" style={{ color: '#8B949E' }}>{plan.narrative}</p>
              </div>
            )}
          </div>
        ) : (
          <a
            href="/plan"
            className="inline-flex items-center gap-1 text-xs font-medium text-[#58A6FF] hover:text-blue-300 transition-colors"
          >
            Generate this week's plan <ChevronRight size={12} />
          </a>
        )}
      </ChatTurn>

      {/* 6 — Recent activities */}
      {activities.length > 0 && (
        <ChatTurn text="Here's what you've done recently.">
          <ActivityFeed activities={activities} compact />
        </ChatTurn>
      )}

      {/* 7 — Train Now */}
      <ChatTurn text="Ready to train now? Tell me what you want to do.">
        <TrainNow athleteId={athleteId} />
      </ChatTurn>

    </div>
  )
}
