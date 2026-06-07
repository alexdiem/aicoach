import { useEffect, useState } from 'react'
import { RefreshCw, CalendarDays, ChevronDown, ChevronRight, Download } from 'lucide-react'
import clsx from 'clsx'
import {
  getCurrentPlan,
  generatePlan,
  markWorkoutComplete,
  setWorkoutUnstructured,
  buildWorkoutStructure,
  downloadWorkoutFit,
  getRoutes,
} from '../api/client'
import SchedulePicker, { toApiSchedule } from '../components/SchedulePicker'
import { useAuth } from '../contexts/AuthContext'
import type { PlannedWorkout, Route, SessionInterval, StructuredSession, WeeklyPlan } from '../types'

const PHASE_STYLES: Record<string, { text: string; bg: string; border: string }> = {
  BASE:     { text: 'text-blue-700',    bg: 'bg-blue-100',    border: 'border-blue-200' },
  BUILD:    { text: 'text-orange-700',  bg: 'bg-orange-100',  border: 'border-orange-200' },
  PEAK:     { text: 'text-rose-700',    bg: 'bg-rose-100',    border: 'border-rose-200' },
  RECOVERY: { text: 'text-emerald-700', bg: 'bg-emerald-100', border: 'border-emerald-200' },
}

const SPORT_ICONS: Record<string, string> = {
  CYCLING: '🚴', RUNNING: '🏃', XC_SKIING: '⛷️', STRENGTH: '💪',
}

const TYPE_STYLES: Record<string, { dot: string; badge: string }> = {
  EASY:      { dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  RECOVERY:  { dot: 'bg-gray-400',    badge: 'bg-gray-100 text-gray-500 border-gray-200' },
  TEMPO:     { dot: 'bg-yellow-500',  badge: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  THRESHOLD: { dot: 'bg-orange-500',  badge: 'bg-orange-100 text-orange-700 border-orange-200' },
  VO2MAX:    { dot: 'bg-rose-500',    badge: 'bg-rose-100 text-rose-700 border-rose-200' },
  LONG:      { dot: 'bg-blue-500',    badge: 'bg-blue-100 text-blue-700 border-blue-200' },
  STRENGTH:  { dot: 'bg-violet-500',  badge: 'bg-violet-100 text-violet-700 border-violet-200' },
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
        <div className={clsx('w-2 h-2 rounded-full shrink-0', isRest ? 'bg-gray-300' : 'bg-blue-500')} />
        <div className="w-px flex-1 bg-gray-200" />
      </div>
      <div className="pb-3 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          {!isRest && step.rep !== undefined && (
            <span className="text-xs font-semibold text-gray-700">
              Rep {step.rep}/{step.total_reps}
            </span>
          )}
          {isRest && <span className="text-xs font-semibold text-gray-400">Rest</span>}
          <span className="text-xs text-gray-400">{step.duration_minutes}min</span>
          {step.target && !isRest && (
            <span className="text-xs font-mono text-indigo-600">{step.target}</span>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{step.notes}</p>
        {step.segment && (
          <p className="text-xs text-amber-600 mt-0.5">
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
    <div className="mt-4 pt-4 border-t border-gray-100">
      {/* Route picker */}
      {showRoutePicker && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-xs text-gray-500 shrink-0">Route:</span>
          <select
            value={selectedRouteId}
            onChange={(e) => setSelectedRouteId(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
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
            className="flex items-center gap-1.5 text-xs text-indigo-600 border border-indigo-200 hover:border-indigo-400 px-2.5 py-1.5 rounded-lg transition-all disabled:opacity-50"
          >
            <RefreshCw size={11} className={rebuilding ? 'animate-spin' : ''} />
            {rebuilding ? 'Updating…' : 'Apply route'}
          </button>
          {session.route_name && (
            <span className="text-xs text-gray-400 italic">Using: {session.route_name}</span>
          )}
        </div>
      )}
      {rebuildError && (
        <p className="text-xs text-rose-700 mb-3">{rebuildError}</p>
      )}

      {/* Garmin download */}
      <div className="mb-4 flex">
        <button
          onClick={handleDownloadFit}
          disabled={downloading}
          className="flex items-center gap-1.5 text-xs text-emerald-600 border border-emerald-200 hover:border-emerald-400 px-2.5 py-1.5 rounded-lg transition-all disabled:opacity-50"
        >
          <Download size={11} className={downloading ? 'animate-bounce' : ''} />
          {downloading ? 'Generating…' : 'Download for Garmin (.fit)'}
        </button>
      </div>

      {/* Route summary */}
      {session.route_summary && (
        <div className="flex items-center gap-3 mb-4 text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2 flex-wrap">
          <span>🗺 {session.route_summary.distance_km} km</span>
          <span className="text-gray-300">·</span>
          <span>↑ {session.route_summary.elevation_gain_m} m</span>
          <span className="text-gray-300">·</span>
          <span>≈ {Math.floor(session.route_summary.estimated_minutes / 60)}h{session.route_summary.estimated_minutes % 60 > 0 ? ` ${session.route_summary.estimated_minutes % 60}min` : ''}</span>
        </div>
      )}

      {/* Warmup */}
      {session.warmup_minutes > 0 && (
        <div className="flex gap-3 mb-1">
          <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
            <div className="w-2 h-2 rounded-full bg-emerald-700" />
            <div className="w-px flex-1 bg-gray-200" />
          </div>
          <div className="pb-3">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold text-emerald-600">Warmup</span>
              <span className="text-xs text-gray-400">{session.warmup_minutes}min</span>
            </div>
            {session.warmup_notes && (
              <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{session.warmup_notes}</p>
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
            <div className="w-2 h-2 rounded-full bg-gray-200" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold text-gray-400">Cooldown</span>
              <span className="text-xs text-gray-400">{session.cooldown_minutes}min</span>
            </div>
            {session.cooldown_notes && (
              <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{session.cooldown_notes}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Plan() {
  const { athleteId: athleteIdOrNull } = useAuth()
  const athleteId = athleteIdOrNull!
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

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>

  const phaseStyle = plan ? (PHASE_STYLES[plan.phase] ?? { text: 'text-gray-400', bg: '', border: '' }) : null

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Weekly Plan</h1>
          {plan && phaseStyle && (
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-sm text-gray-400">Week of {plan.week_start}</span>
              <span className="text-gray-300">·</span>
              <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full border', phaseStyle.text, phaseStyle.bg, phaseStyle.border)}>
                {plan.phase}
              </span>
              <span className="text-gray-300">·</span>
              <span className="text-xs text-gray-400">{plan.season === 'SKI' ? '⛷️ Ski season' : '🚴 Road season'}</span>
            </div>
          )}
        </div>
        <button
          onClick={() => setShowScheduler((v) => !v)}
          className={clsx(
            'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all border shrink-0',
            showScheduler
              ? 'bg-gray-100 border-gray-300 text-gray-700'
              : 'bg-white border-gray-200 text-gray-500 hover:text-gray-800 hover:border-gray-400',
          )}
        >
          <CalendarDays size={14} />
          Set schedule
          <ChevronDown size={13} className={clsx('transition-transform', showScheduler && 'rotate-180')} />
        </button>
      </div>

      {/* Schedule picker panel */}
      {showScheduler && (
        <div className="bg-white rounded-2xl p-5 border border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Your schedule for this week</h2>
          <p className="text-xs text-gray-500 mb-5 leading-relaxed">
            Specify what you want to do on each day. Rest days are respected, sport preferences are honoured, and remaining days are filled automatically.
          </p>
          <div className="mb-5">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2.5 block">Training phase</label>
            <div className="flex gap-2 flex-wrap">
              {[
                { value: 'AUTO',     label: 'Auto-detect',  style: null },
                { value: 'BASE',     label: 'Base',         style: 'border-blue-200 text-blue-700 bg-blue-50' },
                { value: 'BUILD',    label: 'Build',        style: 'border-orange-200 text-orange-700 bg-orange-50' },
                { value: 'PEAK',     label: 'Peak',         style: 'border-rose-200 text-rose-700 bg-rose-50' },
                { value: 'RECOVERY', label: 'Recovery',     style: 'border-emerald-200 text-emerald-700 bg-emerald-50' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPhaseOverride(opt.value)}
                  className={clsx(
                    'px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all',
                    phaseOverride === opt.value
                      ? (opt.style ?? 'border-indigo-400 text-indigo-700 bg-indigo-50')
                      : 'border-gray-200 text-gray-400 hover:border-gray-400 hover:text-gray-700',
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
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            >
              <RefreshCw size={13} className={generating ? 'animate-spin' : ''} />
              {generating ? 'Generating…' : plan ? 'Regenerate' : 'Generate plan'}
            </button>
            <button
              onClick={() => { setSchedule(makeEmptySchedule()); setShowScheduler(false) }}
              className="text-gray-400 hover:text-gray-700 text-sm transition-colors"
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
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          >
            <RefreshCw size={13} className={generating ? 'animate-spin' : ''} />
            {generating ? 'Generating…' : plan ? 'Regenerate plan' : 'Generate plan'}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Phase:</span>
            <select
              value={phaseOverride}
              onChange={(e) => setPhaseOverride(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
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
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-700 text-sm">{error}</div>
      )}

      {plan?.narrative && (
        <div className="bg-indigo-50 rounded-2xl p-5 border border-indigo-100">
          <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wider mb-2">Coach's Note</p>
          <p className="text-sm text-gray-700 leading-relaxed">{plan.narrative}</p>
        </div>
      )}

      {plan ? (
        <div className="flex flex-col gap-2.5">
          {plan.workouts.map((w) => {
            const typeStyle = TYPE_STYLES[w.workout_type] ?? { dot: 'bg-gray-300', badge: 'text-gray-500 bg-gray-100 border-gray-200' }
            const sessionExpanded = expandedSessions.has(w.id)
            const session = sessionOverrides[w.id] ?? w.structured_session
            const hasSession = !!session

            return (
              <div
                key={w.id}
                className={clsx(
                  'bg-white rounded-2xl border transition-all',
                  w.is_unstructured ? 'border-yellow-300' : 'border-gray-200',
                  w.is_completed && 'opacity-60',
                )}
              >
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5 mb-2.5 flex-wrap">
                        <span className="text-lg leading-none">{SPORT_ICONS[w.sport] ?? '🏋️'}</span>
                        <span className="font-semibold text-gray-900 text-sm">
                          {DAYS[w.day_of_week]}
                          <span className="text-gray-400 font-normal"> · {w.sport.replace('_', ' ')}</span>
                        </span>
                        {w.is_unstructured ? (
                          <span className="text-xs px-2 py-0.5 rounded-full border border-amber-200 text-amber-600 bg-amber-50 font-medium">
                            free ride
                          </span>
                        ) : (
                          <>
                            <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium', typeStyle.badge)}>
                              {w.workout_type}
                            </span>
                            {w.intensity_zone && (
                              <span className="text-xs text-gray-400 font-mono">{w.intensity_zone}</span>
                            )}
                          </>
                        )}
                        <span className="text-sm text-gray-600 ml-auto font-semibold tabular-nums">
                          {w.duration_minutes}<span className="text-gray-400 font-normal text-xs">min</span>
                        </span>
                      </div>

                      {w.is_unstructured ? (
                        <p className="text-sm text-gray-400 italic">No structured effort — enjoy the ride and go by feel.</p>
                      ) : (
                        <p className="text-sm text-gray-600 leading-relaxed">{w.purpose}</p>
                      )}

                      {!w.is_unstructured && (() => {
                        const overridden = w.id in sessionOverrides
                        const routeName = (sessionOverrides[w.id] ?? w.structured_session)?.route_name
                        if (routeName) {
                          return <p className="text-xs text-indigo-600 mt-2 font-medium">🗺 {routeName}</p>
                        }
                        if (!overridden && w.terrain_notes) {
                          return <p className="text-xs text-amber-600 mt-2 leading-relaxed">⛰ {w.terrain_notes}</p>
                        }
                        return null
                      })()}

                      {w.ai_compliance_notes && (
                        <p className="text-xs text-gray-400 mt-2 italic">Compliance: {w.ai_compliance_notes}</p>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {w.compliance_score !== null && (
                        <span className={clsx(
                          'text-sm font-bold tabular-nums',
                          w.compliance_score >= 80 ? 'text-emerald-600' : w.compliance_score >= 60 ? 'text-yellow-600' : 'text-rose-600'
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
                              ? 'text-amber-600 border-amber-200 hover:border-amber-400'
                              : 'text-gray-400 border-gray-200 hover:text-gray-700 hover:border-gray-400',
                          )}
                        >
                          {w.is_unstructured ? 'Go structured' : 'Free ride'}
                        </button>
                      )}
                      {w.is_completed ? (
                        <span className="text-emerald-600 text-sm font-medium">✓ Done</span>
                      ) : (
                        <button
                          onClick={() => handleMarkComplete(w)}
                          className="text-xs text-indigo-600 border border-indigo-200 hover:border-indigo-400 px-2.5 py-1 rounded-lg transition-all"
                        >
                          Mark done
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Session plan toggle */}
                {hasSession && !w.is_unstructured && (
                  <div className="border-t border-gray-100">
                    <button
                      onClick={() => toggleSession(w.id)}
                      className="w-full flex items-center gap-2 px-5 py-2.5 text-xs text-gray-400 hover:text-gray-700 transition-colors"
                    >
                      <ChevronRight
                        size={12}
                        className={clsx('transition-transform', sessionExpanded && 'rotate-90')}
                      />
                      Session plan
                      {session.route_name && (
                        <span className="text-gray-400 ml-1">· {session.route_name}</span>
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
        <div className="bg-white rounded-2xl p-12 border border-gray-200 text-center">
          <p className="text-gray-400 mb-2 text-sm">No plan for this week yet.</p>
          <p className="text-gray-400 text-xs leading-relaxed">
            Click "Generate plan" above, or use "Set schedule" to specify which days you want to train.
          </p>
        </div>
      )}
    </div>
  )
}
