import { useEffect, useState } from 'react'
import { getAthleteId, getCurrentPlan, generatePlan, markWorkoutComplete } from '../api/client'
import SchedulePicker, { toApiSchedule } from '../components/SchedulePicker'
import type { PlannedWorkout, WeeklyPlan } from '../types'

const PHASE_COLORS: Record<string, string> = {
  BASE: 'text-blue-400',
  BUILD: 'text-orange-400',
  PEAK: 'text-red-400',
  RECOVERY: 'text-green-400',
}

const SPORT_ICONS: Record<string, string> = {
  CYCLING: '🚴',
  RUNNING: '🏃',
  XC_SKIING: '⛷️',
  STRENGTH: '💪',
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function makeEmptySchedule() {
  return Array.from({ length: 7 }, () => ({ value: null as string | null }))
}

export default function Plan() {
  const athleteId = getAthleteId()!
  const [plan, setPlan] = useState<WeeklyPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showScheduler, setShowScheduler] = useState(false)
  const [schedule, setSchedule] = useState(makeEmptySchedule())

  useEffect(() => {
    getCurrentPlan(athleteId)
      .then(setPlan)
      .finally(() => setLoading(false))
  }, [athleteId])

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    try {
      const apiSchedule = toApiSchedule(schedule)
      await generatePlan(athleteId, apiSchedule)
      const updated = await getCurrentPlan(athleteId)
      setPlan(updated)
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

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-500">Loading…</div>

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Weekly Plan</h1>
          {plan && (
            <p className="text-sm text-gray-500 mt-1">
              Week of {plan.week_start} ·{' '}
              <span className={PHASE_COLORS[plan.phase] ?? 'text-gray-400'}>{plan.phase} phase</span>
              {' · '}
              <span className="text-gray-400">{plan.season === 'SKI' ? '⛷️ Ski season' : '🚴 Road season'}</span>
            </p>
          )}
        </div>
        <button
          onClick={() => setShowScheduler((v) => !v)}
          className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded-lg text-sm font-medium transition-colors border border-gray-700"
        >
          {showScheduler ? 'Hide scheduler' : '📅 Set my schedule'}
        </button>
      </div>

      {/* Schedule picker panel */}
      {showScheduler && (
        <div className="bg-gray-900 rounded-xl p-5 border border-blue-900">
          <h2 className="text-sm font-semibold text-white mb-1">Your schedule for this week</h2>
          <p className="text-xs text-gray-500 mb-4">
            Tell the planner what you want to do on specific days. The plan will respect rest days,
            use your preferred sport, and fill remaining days automatically.
          </p>
          <SchedulePicker schedule={schedule} onChange={setSchedule} />
          <div className="flex items-center gap-3 mt-5">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
            >
              {generating ? 'Generating…' : plan ? 'Regenerate with this schedule' : 'Generate plan'}
            </button>
            <button
              onClick={() => { setSchedule(makeEmptySchedule()); setShowScheduler(false) }}
              className="text-gray-500 hover:text-gray-300 text-sm transition-colors"
            >
              Reset &amp; close
            </button>
          </div>
        </div>
      )}

      {/* Generate button when scheduler is hidden */}
      {!showScheduler && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
          >
            {generating ? 'Generating…' : plan ? 'Regenerate plan' : 'Generate plan'}
          </button>
          <span className="text-xs text-gray-600">
            or use <span className="text-gray-400">📅 Set my schedule</span> to specify days first
          </span>
        </div>
      )}

      {error && (
        <div className="bg-red-950 border border-red-800 rounded-lg p-4 text-red-300 text-sm">{error}</div>
      )}

      {plan?.narrative && (
        <div className="bg-gray-900 rounded-xl p-5 border border-blue-900">
          <p className="text-xs text-blue-400 font-semibold uppercase mb-2">Coach's Note</p>
          <p className="text-gray-300">{plan.narrative}</p>
        </div>
      )}

      {plan ? (
        <div className="flex flex-col gap-3">
          {plan.workouts.map((w) => (
            <div
              key={w.id}
              className="bg-gray-900 rounded-xl p-4 border border-gray-800"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-lg">{SPORT_ICONS[w.sport] ?? '🏋️'}</span>
                    <span className="font-semibold text-white">
                      {DAYS[w.day_of_week]} — {w.sport.replace('_', ' ')}
                    </span>
                    <span className="text-xs px-2 py-0.5 bg-gray-800 rounded text-gray-400">
                      {w.workout_type}
                    </span>
                    {w.intensity_zone && (
                      <span className="text-xs text-blue-400">{w.intensity_zone}</span>
                    )}
                    <span className="text-sm text-gray-400">{w.duration_minutes}min</span>
                  </div>
                  <p className="text-sm text-gray-300">{w.purpose}</p>
                  {w.terrain_notes && (
                    <p className="text-xs text-amber-400 mt-2">🗺 {w.terrain_notes}</p>
                  )}
                  {w.ai_compliance_notes && (
                    <p className="text-xs text-gray-500 mt-2 italic">
                      Compliance: {w.ai_compliance_notes}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  {w.compliance_score !== null && (
                    <div className="text-sm font-bold text-green-400">{w.compliance_score}%</div>
                  )}
                  {w.is_completed ? (
                    <span className="text-green-400 text-sm">✓ Done</span>
                  ) : (
                    <button
                      onClick={() => handleMarkComplete(w)}
                      className="text-xs text-blue-400 hover:text-blue-300 border border-blue-800 hover:border-blue-600 px-3 py-1.5 rounded transition-colors"
                    >
                      Mark done
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-gray-900 rounded-xl p-12 border border-gray-800 text-center">
          <p className="text-gray-500 mb-4">No plan for this week yet.</p>
          <p className="text-gray-600 text-sm">
            Click "Generate plan" above, or use "Set my schedule" to specify which days
            you want to train and what sport you prefer.
          </p>
        </div>
      )}
    </div>
  )
}
