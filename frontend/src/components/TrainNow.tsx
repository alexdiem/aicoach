import { useState } from 'react'
import { Play, Timer, Ruler, ChevronDown, ChevronUp } from 'lucide-react'
import clsx from 'clsx'
import { trainNow } from '../api/client'
import type { TrainNowResult } from '../api/client'
import type { SessionInterval, StructuredSession } from '../types'

function IntervalRow({ step }: { step: SessionInterval }) {
  const isRest = step.type === 'rest'
  return (
    <div className={clsx('flex gap-3', isRest && 'opacity-50')}>
      <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
        <div className={clsx('w-2 h-2 rounded-full shrink-0', isRest ? 'bg-gray-300' : 'bg-orange-500')} />
        <div className="w-px flex-1 bg-gray-200" />
      </div>
      <div className="pb-3 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          {!isRest && step.rep !== undefined && (
            <span className="text-xs font-semibold text-gray-700">Rep {step.rep}/{step.total_reps}</span>
          )}
          {isRest && <span className="text-xs font-semibold text-gray-400">Rest</span>}
          <span className="text-xs text-gray-400">{step.duration_minutes}min</span>
          {step.target && !isRest && <span className="text-xs font-mono text-orange-600">{step.target}</span>}
        </div>
        <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{step.notes}</p>
      </div>
    </div>
  )
}

function SessionView({ session }: { session: StructuredSession }) {
  return (
    <div className="pt-3 border-t border-gray-100 mt-2">
      {session.warmup_minutes > 0 && (
        <div className="flex gap-3 mb-1">
          <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <div className="w-px flex-1 bg-gray-200" />
          </div>
          <div className="pb-3">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold text-emerald-600">Warmup</span>
              <span className="text-xs text-gray-400">{session.warmup_minutes}min</span>
            </div>
            {session.warmup_notes && <p className="text-xs text-gray-400 mt-0.5">{session.warmup_notes}</p>}
          </div>
        </div>
      )}
      {session.intervals.map((step, i) => <IntervalRow key={i} step={step} />)}
      {session.cooldown_minutes > 0 && (
        <div className="flex gap-3">
          <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
            <div className="w-2 h-2 rounded-full bg-gray-300" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold text-gray-400">Cooldown</span>
              <span className="text-xs text-gray-400">{session.cooldown_minutes}min</span>
            </div>
            {session.cooldown_notes && <p className="text-xs text-gray-400 mt-0.5">{session.cooldown_notes}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

const SPORTS = [
  { value: 'CYCLING', label: 'Cycling', emoji: '🚴' },
  { value: 'RUNNING', label: 'Running', emoji: '🏃' },
  { value: 'XC_SKIING', label: 'XC Skiing', emoji: '⛷️' },
]

const DURATIONS = [30, 45, 60, 75, 90, 120]

interface Props {
  athleteId: number
}

export default function TrainNow({ athleteId }: Props) {
  const [sport, setSport] = useState('CYCLING')
  const [mode, setMode] = useState<'time' | 'distance'>('time')
  const [duration, setDuration] = useState(60)
  const [distance, setDistance] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<TrainNowResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sessionOpen, setSessionOpen] = useState(false)

  async function handleGenerate() {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await trainNow(
        athleteId,
        sport,
        mode === 'time' ? duration : undefined,
        mode === 'distance' ? parseFloat(distance) : undefined,
      )
      setResult(res)
      setSessionOpen(true)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to generate session'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const distanceValid = mode === 'distance' && parseFloat(distance) > 0
  const canGenerate = !loading && (mode === 'time' || distanceValid)

  const workoutTypeLabel: Record<string, string> = {
    THRESHOLD: 'Threshold',
    TEMPO: 'Tempo',
    EASY: 'Easy',
    RECOVERY: 'Recovery',
    VO2MAX: 'VO2max',
    LONG: 'Long',
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="p-5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">Train Now</p>

        {/* Sport selector */}
        <div className="flex gap-2 mb-4">
          {SPORTS.map((s) => (
            <button
              key={s.value}
              onClick={() => setSport(s.value)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all border',
                sport === s.value
                  ? 'bg-orange-600 border-orange-600 text-white'
                  : 'bg-white border-gray-200 text-gray-600 hover:text-gray-900 hover:border-gray-300',
              )}
            >
              <span>{s.emoji}</span>
              {s.label}
            </button>
          ))}
        </div>

        {/* Time / distance toggle */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('time')}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
              mode === 'time'
                ? 'bg-gray-100 border-gray-200 text-gray-900'
                : 'bg-white border-gray-200 text-gray-400 hover:text-gray-700',
            )}
          >
            <Timer size={12} /> Time
          </button>
          <button
            onClick={() => setMode('distance')}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
              mode === 'distance'
                ? 'bg-gray-100 border-gray-200 text-gray-900'
                : 'bg-white border-gray-200 text-gray-400 hover:text-gray-700',
            )}
          >
            <Ruler size={12} /> Distance
          </button>
        </div>

        {mode === 'time' ? (
          <div className="flex gap-2 flex-wrap mb-4">
            {DURATIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDuration(d)}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-all border',
                  duration === d
                    ? 'bg-gray-100 border-gray-300 text-gray-900'
                    : 'bg-white border-gray-200 text-gray-500 hover:text-gray-800',
                )}
              >
                {d}m
              </button>
            ))}
          </div>
        ) : (
          <div className="mb-4 flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={200}
              placeholder="km"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              className="w-24 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:border-orange-400"
            />
            <span className="text-sm text-gray-400">km</span>
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
            canGenerate
              ? 'bg-orange-600 hover:bg-orange-700 text-white'
              : 'bg-gray-100 text-gray-300 cursor-not-allowed',
          )}
        >
          <Play size={14} className={loading ? 'animate-pulse' : ''} />
          {loading ? 'Building session…' : 'Generate session'}
        </button>

        {error && <p className="mt-3 text-xs text-rose-500">{error}</p>}
      </div>

      {/* Result */}
      {result && (
        <div className="border-t border-gray-100">
          {/* Summary bar */}
          <div className="px-5 py-4 flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-orange-600 uppercase tracking-wider">
                  {workoutTypeLabel[result.workout_type] ?? result.workout_type}
                </span>
                <span className="text-gray-300">·</span>
                <span className="text-xs text-gray-400">{result.duration_minutes} min</span>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">{result.narrative}</p>
            </div>
            <button
              onClick={() => setSessionOpen((o) => !o)}
              className="shrink-0 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors"
            >
              {sessionOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {sessionOpen ? 'Hide' : 'Show'} plan
            </button>
          </div>

          {sessionOpen && result.session && (
            <div className="px-5 pb-5">
              <SessionView session={result.session} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
