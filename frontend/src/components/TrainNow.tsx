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
        <div className={clsx('w-2 h-2 rounded-full shrink-0', isRest ? 'bg-zinc-600' : 'bg-blue-500')} />
        <div className="w-px flex-1 bg-zinc-800" />
      </div>
      <div className="pb-3 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          {!isRest && step.rep !== undefined && (
            <span className="text-xs font-semibold text-zinc-300">Rep {step.rep}/{step.total_reps}</span>
          )}
          {isRest && <span className="text-xs font-semibold text-zinc-500">Rest</span>}
          <span className="text-xs text-zinc-500">{step.duration_minutes}min</span>
          {step.target && !isRest && <span className="text-xs font-mono text-blue-400">{step.target}</span>}
        </div>
        <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{step.notes}</p>
      </div>
    </div>
  )
}

function SessionView({ session }: { session: StructuredSession }) {
  return (
    <div className="pt-3 border-t border-zinc-800 mt-2">
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
            {session.warmup_notes && <p className="text-xs text-zinc-500 mt-0.5">{session.warmup_notes}</p>}
          </div>
        </div>
      )}
      {session.intervals.map((step, i) => <IntervalRow key={i} step={step} />)}
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
            {session.cooldown_notes && <p className="text-xs text-zinc-600 mt-0.5">{session.cooldown_notes}</p>}
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
    <div className="rounded-xl border border-zinc-800 overflow-hidden" style={{ backgroundColor: '#0A0A0F' }}>
      <div className="p-4">
        <p className="text-zinc-600 uppercase tracking-widest mb-3" style={{ fontSize: '10px' }}>Train Now</p>

        {/* Sport selector */}
        <div className="flex gap-1.5 mb-3 flex-wrap">
          {SPORTS.map((s) => (
            <button
              key={s.value}
              onClick={() => setSport(s.value)}
              className={clsx(
                'flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium transition-all border',
                sport === s.value
                  ? 'border-amber-500/50 text-amber-400'
                  : 'border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700',
              )}
              style={sport === s.value ? { backgroundColor: '#F59E0B22' } : { backgroundColor: '#12121A' }}
            >
              <span>{s.emoji}</span>
              {s.label}
            </button>
          ))}
        </div>

        {/* Time / distance toggle */}
        <div className="flex gap-1.5 mb-3">
          <button
            onClick={() => setMode('time')}
            className={clsx(
              'flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-all border',
              mode === 'time'
                ? 'border-zinc-600 text-white bg-zinc-800'
                : 'border-zinc-800 text-zinc-500 hover:text-zinc-300',
            )}
          >
            <Timer size={11} /> Time
          </button>
          <button
            onClick={() => setMode('distance')}
            className={clsx(
              'flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-all border',
              mode === 'distance'
                ? 'border-zinc-600 text-white bg-zinc-800'
                : 'border-zinc-800 text-zinc-500 hover:text-zinc-300',
            )}
          >
            <Ruler size={11} /> Distance
          </button>
        </div>

        {mode === 'time' ? (
          <div className="flex gap-1.5 flex-wrap mb-3">
            {DURATIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDuration(d)}
                className={clsx(
                  'px-2.5 py-1 rounded text-xs font-medium transition-all border',
                  duration === d
                    ? 'border-zinc-600 text-white bg-zinc-800'
                    : 'border-zinc-800 text-zinc-500 hover:text-zinc-200',
                )}
              >
                {d}m
              </button>
            ))}
          </div>
        ) : (
          <div className="mb-3 flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={200}
              placeholder="km"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              className="w-20 border border-zinc-800 rounded px-2.5 py-1 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500"
              style={{ backgroundColor: '#12121A' }}
            />
            <span className="text-xs text-zinc-500">km</span>
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all border',
            canGenerate
              ? 'border-amber-500/60 text-amber-400 hover:border-amber-400'
              : 'border-zinc-800 text-zinc-600 cursor-not-allowed',
          )}
          style={canGenerate ? { backgroundColor: '#F59E0B22' } : { backgroundColor: '#12121A' }}
        >
          <Play size={12} className={loading ? 'animate-pulse' : ''} />
          {loading ? 'Building…' : 'Generate session'}
        </button>

        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
      </div>

      {/* Result */}
      {result && (
        <div className="border-t border-zinc-800">
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#06B6D4' }}>
                  {workoutTypeLabel[result.workout_type] ?? result.workout_type}
                </span>
                <span className="text-zinc-700">·</span>
                <span className="text-xs text-zinc-500">{result.duration_minutes} min</span>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">{result.narrative}</p>
            </div>
            <button
              onClick={() => setSessionOpen((o) => !o)}
              className="shrink-0 flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {sessionOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {sessionOpen ? 'Hide' : 'Show'}
            </button>
          </div>

          {sessionOpen && result.session && (
            <div className="px-4 pb-4">
              <SessionView session={result.session} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
