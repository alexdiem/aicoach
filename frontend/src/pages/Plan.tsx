import { useEffect, useState } from 'react'
import { RefreshCw, CalendarDays, ChevronDown, ChevronRight, Download } from 'lucide-react'
import clsx from 'clsx'
import {
  getAthleteId,
  getCurrentPlan,
  generatePlan,
  markWorkoutComplete,
  setWorkoutUnstructured,
  buildWorkoutStructure,
  downloadWorkoutFit,
  getRoutes,
} from '../api/client'
import SchedulePicker, { toApiSchedule } from '../components/SchedulePicker'
import type { PlannedWorkout, Route, SessionInterval, StructuredSession, WeeklyPlan } from '../types'

const PHASE_STYLES: Record<string, { text: string; bg: string; border: string }> = {
  BASE:     { text: 'text-blue-400',    bg: 'bg-blue-950/50',    border: 'border-blue-900' },
  BUILD:    { text: 'text-orange-400',  bg: 'bg-orange-950/50',  border: 'border-orange-900' },
  PEAK:     { text: 'text-rose-400',    bg: 'bg-rose-950/50',    border: 'border-rose-900' },
  RECOVERY: { text: 'text-emerald-400', bg: 'bg-emerald-950/50', border: 'border-emerald-900' },
}

const SPORT_ICONS: Record<string, string> = {
  CYCLING: '🚴', RUNNING: '🏃', XC_SKIING: '⛷️', STRENGTH: '💪',
}

const TYPE_STYLES: Record<string, { dot: string; badge: string }> = {
  EASY:      { dot: 'bg-emerald-500', badge: 'text-emerald-400 bg-emerald-950/60 border-emerald-900' },
  RECOVERY:  { dot: 'bg-zinc-500',    badge: 'text-zinc-400 bg-zinc-800 border-zinc-700' },
  TEMPO:     { dot: 'bg-yellow-500',  badge: 'text-yellow-400 bg-yellow-950/60 border-yellow-900' },
  THRESHOLD: { dot: 'bg-orange-500',  badge: 'text-orange-400 bg-orange-950/60 border-orange-900' },
  VO2MAX:    { dot: 'bg-rose-500',    badge: 'text-rose-400 bg-rose-950/60 border-rose-900' },
  LONG:      { dot: 'bg-blue-500',    badge: 'text-blue-400 bg-blue-950/60 border-blue-900' },
  STRENGTH:  { dot: 'bg-violet-500',  badge: 'text-violet-400 bg-violet-950/60 border-violet-900' },
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function makeEmptySchedule() {
  return Array.from({ length: 7 }, () => ({ value: null as string | null }))
}

// ─── Session plan display ──────────────────────────────────────────────────

function IntervalStep({ step }: { step: SessionInterval }) {
  const isRest = step.type === 'rest'
  return (
    <div className={clsx('flex gap-3', isRest && 'opacity-60')}>
      <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
        <div className={clsx('w-2 h-2 rounded-full shrink-0', isRest ? 'bg-zinc-600' : 'bg-blue-500')} />
        <div className="w-px flex-1 bg-zinc-800" />
      </div>
      <div className="pb-3 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          {!isRest && step.rep !== undefined && (
            <span className="text-xs font-semibold text-zinc-300">
              Rep {step.rep}/{step.total_reps}
            </span>
          )}
          {isRest && <span className="text-xs font-semibold text-zinc-500">Rest</span>}
          <span className="text-xs text-zinc-500">{step.duration_minutes}min</span>
          {step.target && !isRest && (
            <span className="text-xs font-mono text-blue-400">{step.target}</span>
          )}
        </div>
        <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{step.notes}</p>
        {step.segment && (
          <p className="text-xs text-amber-400/80 mt-0.5">
            ⛰ {step.segment.category.replace(/_/g, ' ').toLowerCase()} ·{' '}
            {step.segment.length_meters >= 1000
              ? `${(step.segment.length_meters / 1000).toFixed(1)}km`
              : `${step.segment.length_meters}m`}{' '}
            at {step.segment.avg_gradient_pct}%
          </p>
        )}
      </div>
    </div>
  )
}

function SessionPlan({
  session,
  workoutId,
  athleteId,
  sport,
  workoutType,
  routes,
  onRebuild,
}: {
  session: StructuredSession
  workoutId: number
  athleteId: number
  sport: string
  workoutType: string
  routes: Route[]
  onRebuild: (session: StructuredSession) => void
}) {
  const [selectedRouteId, setSelectedRouteId] = useState<string>(
    session.route_id ? String(session.route_id) : ''
  )
  const [rebuilding, setRebuilding] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [rebuildError, setRebuildError] = useState<string | null>(null)

  async function handleApplyRoute() {
    setRebuilding(true)
    setRebuildError(null)
    try {
      const updated = await buildWorkoutStructure(
        workoutId,
        athleteId,
        selectedRouteId ? Number(selectedRouteId) : undefined,
      )
      onRebuild(updated)
    } catch (e: unknown) {
      setRebuildError(e instanceof Error ? e.message : 'Failed to apply route')
    } finally {
      setRebuilding(false)
    }
  }

  async function handleDownloadFit() {
    setDownloading(true)
    try {
      const filename = `workout_${workoutType}_${sport}.fit`.toLowerCase().replace(/\s+/g, '_')
      await downloadWorkoutFit(workoutId, athleteId, filename)
    } finally {
      setDownloading(false)
    }
  }

  const showRoutePicker = sport === 'CYCLING' && routes.length > 0

  return (
    <div className="mt-4 pt-4 border-t border-zinc-800">
      {/* Route picker */}
      {showRoutePicker && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-xs text-zinc-500 shrink-0">Route:</span>
          <select
            value={selectedRouteId}
            onChange={(e) => setSelectedRouteId(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
          >
            <option value="">No route (indoor / unspecified)</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} — {r.distance_km}km ↑{r.elevation_gain_m}m
              </option>
            ))}
          </select>
          <button
            onClick={handleApplyRoute}
            disabled={rebuilding}
            className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 border border-blue-900/60 hover:border-blue-700 px-2.5 py-1.5 rounded-lg transition-all disabled:opacity-50"
          >
            <RefreshCw size={11} className={rebuilding ? 'animate-spin' : ''} />
            {rebuilding ? 'Updating…' : 'Apply route'}
          </button>
          {session.route_name && (
            <span className="text-xs text-zinc-600 italic">Using: {session.route_name}</span>
          )}
        </div>
      )}
      {rebuildError && (
        <p className="text-xs text-red-400 mb-3">{rebuildError}</p>
      )}

      {/* Garmin download */}
      <div className="mb-4 flex">
        <button
          onClick={handleDownloadFit}
          disabled={downloading}
          className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-900/60 hover:border-emerald-700 px-2.5 py-1.5 rounded-lg transition-all disabled:opacity-50"
        >
          <Download size={11} className={downloading ? 'animate-bounce' : ''} />
          {downloading ? 'Generating…' : 'Download for Garmin (.fit)'}
        </button>
      </div>

      {/* Route summary */}
      {session.route_summary && (
        <div className="flex items-center gap-3 mb-4 text-xs text-zinc-400 bg-zinc-800/60 rounded-xl px-3 py-2 flex-wrap">
          <span>🗺 {session.route_summary.distance_km} km</span>
          <span className="text-zinc-600">·</span>
          <span>↑ {session.route_summary.elevation_gain_m} m</span>
          <span className="text-zinc-600">·</span>
          <span>≈ {Math.floor(session.route_summary.estimated_minutes / 60)}h{session.route_summary.estimated_minutes % 60 > 0 ? ` ${session.route_summary.estimated_minutes % 60}min` : ''}</span>
        </div>
      )}

      {/* Warmup */}
      {session.warmup_minutes > 0 && (
        <div className="flex gap-3 mb-1">
          <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
            <div className="w-2 h-2 rounded-full bg-emerald-700" />
            <div className="w-px flex-1 bg-zinc-800" />
          </div>
          <div className="pb-3">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold text-emerald-600">Warmup</span>
              <span className="text-xs text-zinc-500">{session.warmup_minutes}min</span>
            </div>
            {session.warmup_notes && (
              <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{session.warmup_notes}</p>
            )}
          </div>
        </div>
      )}

      {/* Intervals */}
      {session.intervals.map((step, i) => (
        <IntervalStep key={i} step={step} />
      ))}

      {/* Cooldown */}
      {session.cooldown_minutes > 0 && (
        <div className="flex gap-3">
          <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
            <div className="w-2 h-2 rounded-full bg-zinc-700" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold text-zinc-600">Cooldown</span>
              <span className="text-xs text-zinc-600">{session.cooldown_minutes}min</span>
            </div>
            {session.cooldown_notes && (
              <p className="text-xs text-zinc-600 mt-0.5 leading-relaxed">{session.cooldown_notes}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Plan() {
  const athleteId = getAthleteId()!
  const [plan, setPlan] = useState<WeeklyPlan | null>(null)
  const [routes, setRoutes] = useState<Route[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showScheduler, setShowScheduler] = useState(false)
  const [schedule, setSchedule] = useState(makeEmptySchedule())
  const [phaseOverride, setPhaseOverride] = useState<string>('AUTO')
  const [expandedSessions, setExpandedSessions] = useState<Set<number>>(new Set())
  // Local overrides for structured sessions after route changes
  const [sessionOverrides, setSessionOverrides] = useState<Record<number, StructuredSession>>({})

  useEffect(() => {
    Promise.all([getCurrentPlan(athleteId), getRoutes(athleteId)])
      .then(([p, r]) => { setPlan(p); setRoutes(r) })
      .finally(() => setLoading(false))
  }, [athleteId])

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    try {
      const apiSchedule = toApiSchedule(schedule)
      await generatePlan(athleteId, apiSchedule, phaseOverride === 'AUTO' ? null : phaseOverride)
      const updated = await getCurrentPlan(athleteId)
      setPlan(updated)
      setSessionOverrides({})
      setShowScheduler(false)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      setError(`Failed to generate plan: ${msg}`)
    } finally {
      setGenerating(false)
    }
  }

  async function handleMarkComplete(workout: PlannedWorkout) {
    await markWorkoutComplete(workout.id, athleteId)
    const updated = await getCurrentPlan(athleteId)
    setPlan(updated)
  }

  async function handleToggleUnstructured(workout: PlannedWorkout) {
    await setWorkoutUnstructured(workout.id, athleteId, !workout.is_unstructured)
    const updated = await getCurrentPlan(athleteId)
    setPlan(updated)
  }

  function toggleSession(workoutId: number) {
    setExpandedSessions((prev) => {
      const next = new Set(prev)
      next.has(workoutId) ? next.delete(workoutId) : next.add(workoutId)
      return next
    })
  }

  function handleSessionRebuild(workoutId: number, session: StructuredSession) {
    setSessionOverrides((prev) => ({ ...prev, [workoutId]: session }))
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-zinc-500 text-sm">Loading…</div>

  const phaseStyle = plan ? (PHASE_STYLES[plan.phase] ?? { text: 'text-zinc-400', bg: '', border: '' }) : null

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Weekly Plan</h1>
          {plan && phaseStyle && (
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-sm text-zinc-500">Week of {plan.week_start}</span>
              <span className="text-zinc-700">·</span>
              <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full border', phaseStyle.text, phaseStyle.bg, phaseStyle.border)}>
                {plan.phase}
              </span>
              <span className="text-zinc-700">·</span>
              <span className="text-xs text-zinc-500">{plan.season === 'SKI' ? '⛷️ Ski season' : '🚴 Road season'}</span>
            </div>
          )}
        </div>
        <button
          onClick={() => setShowScheduler((v) => !v)}
          className={clsx(
            'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all border shrink-0',
            showScheduler
              ? 'bg-zinc-800 border-zinc-600 text-zinc-200'
              : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600',
          )}
        >
          <CalendarDays size={14} />
          Set schedule
          <ChevronDown size={13} className={clsx('transition-transform', showScheduler && 'rotate-180')} />
        </button>
      </div>

      {/* Schedule picker panel */}
      {showScheduler && (
        <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800">
          <h2 className="text-sm font-semibold text-white mb-1">Your schedule for this week</h2>
          <p className="text-xs text-zinc-500 mb-5 leading-relaxed">
            Specify what you want to do on each day. Rest days are respected, sport preferences are honoured, and remaining days are filled automatically.
          </p>
          <div className="mb-5">
            <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2.5 block">Training phase</label>
            <div className="flex gap-2 flex-wrap">
              {[
                { value: 'AUTO',     label: 'Auto-detect',  style: null },
                { value: 'BASE',     label: 'Base',         style: 'border-blue-700 text-blue-300 bg-blue-950/40' },
                { value: 'BUILD',    label: 'Build',        style: 'border-orange-700 text-orange-300 bg-orange-950/40' },
                { value: 'PEAK',     label: 'Peak',         style: 'border-rose-700 text-rose-300 bg-rose-950/40' },
                { value: 'RECOVERY', label: 'Recovery',     style: 'border-emerald-700 text-emerald-300 bg-emerald-950/40' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPhaseOverride(opt.value)}
                  className={clsx(
                    'px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all',
                    phaseOverride === opt.value
                      ? (opt.style ?? 'border-zinc-500 text-zinc-200 bg-zinc-800')
                      : 'border-zinc-800 text-zinc-600 hover:border-zinc-600 hover:text-zinc-400',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <SchedulePicker schedule={schedule} onChange={setSchedule} />
          <div className="flex items-center gap-3 mt-5">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            >
              <RefreshCw size={13} className={generating ? 'animate-spin' : ''} />
              {generating ? 'Generating…' : plan ? 'Regenerate' : 'Generate plan'}
            </button>
            <button
              onClick={() => { setSchedule(makeEmptySchedule()); setShowScheduler(false) }}
              className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
            >
              Reset &amp; close
            </button>
          </div>
        </div>
      )}

      {/* Quick generate bar */}
      {!showScheduler && (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          >
            <RefreshCw size={13} className={generating ? 'animate-spin' : ''} />
            {generating ? 'Generating…' : plan ? 'Regenerate plan' : 'Generate plan'}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-600">Phase:</span>
            <select
              value={phaseOverride}
              onChange={(e) => setPhaseOverride(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
            >
              <option value="AUTO">Auto-detect</option>
              <option value="BASE">Base</option>
              <option value="BUILD">Build</option>
              <option value="PEAK">Peak</option>
              <option value="RECOVERY">Recovery</option>
            </select>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-950/60 border border-red-800 rounded-xl p-4 text-red-300 text-sm">{error}</div>
      )}

      {plan?.narrative && (
        <div className="bg-zinc-900 rounded-2xl p-5 border border-blue-900/40">
          <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-2">Coach's Note</p>
          <p className="text-sm text-zinc-300 leading-relaxed">{plan.narrative}</p>
        </div>
      )}

      {plan ? (
        <div className="flex flex-col gap-2.5">
          {plan.workouts.map((w) => {
            const typeStyle = TYPE_STYLES[w.workout_type] ?? { dot: 'bg-zinc-600', badge: 'text-zinc-400 bg-zinc-800 border-zinc-700' }
            const sessionExpanded = expandedSessions.has(w.id)
            const session = sessionOverrides[w.id] ?? w.structured_session
            const hasSession = !!session

            return (
              <div
                key={w.id}
                className={clsx(
                  'bg-zinc-900 rounded-2xl border transition-all',
                  w.is_unstructured ? 'border-yellow-900/60' : 'border-zinc-800',
                  w.is_completed && 'opacity-60',
                )}
              >
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5 mb-2.5 flex-wrap">
                        <span className="text-lg leading-none">{SPORT_ICONS[w.sport] ?? '🏋️'}</span>
                        <span className="font-semibold text-white text-sm">
                          {DAYS[w.day_of_week]}
                          <span className="text-zinc-500 font-normal"> · {w.sport.replace('_', ' ')}</span>
                        </span>
                        {w.is_unstructured ? (
                          <span className="text-xs px-2 py-0.5 rounded-full border border-yellow-800/60 text-yellow-400 bg-yellow-950/40 font-medium">
                            free ride
                          </span>
                        ) : (
                          <>
                            <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium', typeStyle.badge)}>
                              {w.workout_type}
                            </span>
                            {w.intensity_zone && (
                              <span className="text-xs text-zinc-500 font-mono">{w.intensity_zone}</span>
                            )}
                          </>
                        )}
                        <span className="text-sm text-zinc-400 ml-auto font-semibold tabular-nums">
                          {w.duration_minutes}<span className="text-zinc-600 font-normal text-xs">min</span>
                        </span>
                      </div>

                      {w.is_unstructured ? (
                        <p className="text-sm text-zinc-500 italic">No structured effort — enjoy the ride and go by feel.</p>
                      ) : (
                        <p className="text-sm text-zinc-400 leading-relaxed">{w.purpose}</p>
                      )}

                      {!w.is_unstructured && w.terrain_notes && (
                        <p className="text-xs text-amber-400/80 mt-2 leading-relaxed">⛰ {w.terrain_notes}</p>
                      )}

                      {w.ai_compliance_notes && (
                        <p className="text-xs text-zinc-600 mt-2 italic">Compliance: {w.ai_compliance_notes}</p>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {w.compliance_score !== null && (
                        <span className={clsx(
                          'text-sm font-bold tabular-nums',
                          w.compliance_score >= 80 ? 'text-emerald-400' : w.compliance_score >= 60 ? 'text-yellow-400' : 'text-rose-400'
                        )}>
                          {w.compliance_score}%
                        </span>
                      )}
                      {!w.is_completed && (
                        <button
                          onClick={() => handleToggleUnstructured(w)}
                          className={clsx(
                            'text-xs px-2.5 py-1 rounded-lg border transition-all',
                            w.is_unstructured
                              ? 'text-yellow-400 border-yellow-800/60 hover:border-yellow-600'
                              : 'text-zinc-600 border-zinc-800 hover:text-zinc-300 hover:border-zinc-600',
                          )}
                        >
                          {w.is_unstructured ? 'Go structured' : 'Free ride'}
                        </button>
                      )}
                      {w.is_completed ? (
                        <span className="text-emerald-400 text-sm font-medium">✓ Done</span>
                      ) : (
                        <button
                          onClick={() => handleMarkComplete(w)}
                          className="text-xs text-blue-400 hover:text-blue-300 border border-blue-900/60 hover:border-blue-700 px-2.5 py-1 rounded-lg transition-all"
                        >
                          Mark done
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Session plan toggle */}
                {hasSession && !w.is_unstructured && (
                  <div className="border-t border-zinc-800">
                    <button
                      onClick={() => toggleSession(w.id)}
                      className="w-full flex items-center gap-2 px-5 py-2.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      <ChevronRight
                        size={12}
                        className={clsx('transition-transform', sessionExpanded && 'rotate-90')}
                      />
                      Session plan
                      {session.route_name && (
                        <span className="text-zinc-600 ml-1">· {session.route_name}</span>
                      )}
                    </button>

                    {sessionExpanded && (
                      <div className="px-5 pb-5">
                        <SessionPlan
                          session={session}
                          workoutId={w.id}
                          athleteId={athleteId}
                          sport={w.sport}
                          workoutType={w.workout_type}
                          routes={routes}
                          onRebuild={(s) => handleSessionRebuild(w.id, s)}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-2xl p-12 border border-zinc-800 text-center">
          <p className="text-zinc-500 mb-2 text-sm">No plan for this week yet.</p>
          <p className="text-zinc-600 text-xs leading-relaxed">
            Click "Generate plan" above, or use "Set schedule" to specify which days you want to train.
          </p>
        </div>
      )}
    </div>
  )
}
