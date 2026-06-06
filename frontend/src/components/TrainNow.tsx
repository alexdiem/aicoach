import { useState } from 'react'
import { Play, ChevronDown, ChevronUp } from 'lucide-react'
import clsx from 'clsx'
import { trainNow } from '../api/client'
import type { TrainNowResult } from '../api/client'
import type { SessionInterval, StructuredSession } from '../types'

function IntervalRow({ step }: { step: SessionInterval }) {
  const isRest = step.type === 'rest'
  return (
    <div className={clsx('font-mono text-xs py-1 border-b border-lime-400/10 last:border-0', isRest && 'opacity-40')}>
      <span className="text-lime-400/50 mr-2">
        {isRest ? 'REST' : `REP ${step.rep}/${step.total_reps}`}
      </span>
      <span className="text-lime-400/70">{step.duration_minutes}min</span>
      {step.target && !isRest && (
        <span className="text-lime-400 ml-2">[{step.target}]</span>
      )}
      {step.notes && (
        <span className="block text-lime-400/40 pl-4 mt-0.5">{step.notes}</span>
      )}
    </div>
  )
}

function SessionView({ session }: { session: StructuredSession }) {
  return (
    <div className="pt-3 border-t border-lime-400/20 mt-2 font-mono">
      {session.warmup_minutes > 0 && (
        <div className="text-xs py-1 border-b border-lime-400/10">
          <span className="text-lime-400/50 mr-2">WARMUP</span>
          <span className="text-lime-400/70">{session.warmup_minutes}min</span>
          {session.warmup_notes && (
            <span className="block text-lime-400/40 pl-4 mt-0.5">{session.warmup_notes}</span>
          )}
        </div>
      )}
      {session.intervals.map((step, i) => <IntervalRow key={i} step={step} />)}
      {session.cooldown_minutes > 0 && (
        <div className="text-xs py-1">
          <span className="text-lime-400/30 mr-2">COOLDOWN</span>
          <span className="text-lime-400/30">{session.cooldown_minutes}min</span>
          {session.cooldown_notes && (
            <span className="block text-lime-400/20 pl-4 mt-0.5">{session.cooldown_notes}</span>
          )}
        </div>
      )}
    </div>
  )
}

const SPORTS = [
  { value: 'CYCLING', label: 'CYCLING' },
  { value: 'RUNNING', label: 'RUNNING' },
  { value: 'XC_SKIING', label: 'XC SKIING' },
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
    THRESHOLD: 'THRESHOLD',
    TEMPO: 'TEMPO',
    EASY: 'EASY',
    RECOVERY: 'RECOVERY',
    VO2MAX: 'VO2MAX',
    LONG: 'LONG',
  }

  return (
    <div className="border border-lime-400/20 overflow-hidden font-mono">
      <div className="p-5">
        <p className="font-mono text-lime-400 text-xs mb-4">&gt; TRAIN NOW</p>

        {/* Sport selector */}
        <div className="flex gap-0 mb-4 border border-lime-400/30">
          {SPORTS.map((s) => (
            <button
              key={s.value}
              onClick={() => setSport(s.value)}
              className={clsx(
                'flex-1 px-3 py-2 text-xs font-mono uppercase tracking-widest transition-all border-r border-lime-400/30 last:border-r-0',
                sport === s.value
                  ? 'bg-lime-400 text-black'
                  : 'text-lime-400/50 hover:bg-lime-400 hover:text-black',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Time / distance toggle */}
        <div className="flex gap-0 mb-4 border border-lime-400/30 w-fit">
          <button
            onClick={() => setMode('time')}
            className={clsx(
              'px-3 py-1.5 text-xs font-mono uppercase tracking-widest transition-all border-r border-lime-400/30',
              mode === 'time'
                ? 'bg-lime-400 text-black'
                : 'text-lime-400/50 hover:bg-lime-400 hover:text-black',
            )}
          >
            TIME
          </button>
          <button
            onClick={() => setMode('distance')}
            className={clsx(
              'px-3 py-1.5 text-xs font-mono uppercase tracking-widest transition-all',
              mode === 'distance'
                ? 'bg-lime-400 text-black'
                : 'text-lime-400/50 hover:bg-lime-400 hover:text-black',
            )}
          >
            DISTANCE
          </button>
        </div>

        {mode === 'time' ? (
          <div className="flex gap-2 flex-wrap mb-4">
            {DURATIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDuration(d)}
                className={clsx(
                  'px-3 py-1.5 text-xs font-mono uppercase tracking-widest transition-all border',
                  duration === d
                    ? 'bg-lime-400 border-lime-400 text-black'
                    : 'border-lime-400/30 text-lime-400/50 hover:bg-lime-400 hover:text-black hover:border-lime-400',
                )}
              >
                {d}M
              </button>
            ))}
          </div>
        ) : (
          <div className="mb-4 flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={200}
              placeholder="KM"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              className="w-24 bg-black border border-lime-400/30 px-3 py-1.5 text-xs text-lime-400 font-mono placeholder-lime-400/20 focus:outline-none focus:border-lime-400"
            />
            <span className="text-xs text-lime-400/40 font-mono">KM</span>
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className={clsx(
            'w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-mono font-semibold uppercase tracking-widest transition-all',
            canGenerate
              ? 'bg-lime-400 text-black hover:bg-lime-300'
              : 'bg-black border border-lime-400/20 text-lime-400/20 cursor-not-allowed',
          )}
        >
          <Play size={14} className={loading ? 'animate-pulse' : ''} />
          {loading ? 'BUILDING SESSION...' : 'GENERATE SESSION'}
        </button>

        {error && <p className="mt-3 text-xs text-lime-400/60 font-mono">ERROR: {error}</p>}
      </div>

      {/* Result */}
      {result && (
        <div className="border-t border-lime-400/20">
          <div className="px-5 py-4 flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-lime-400 font-mono uppercase tracking-widest">
                  {workoutTypeLabel[result.workout_type] ?? result.workout_type}
                </span>
                <span className="text-lime-400/30">·</span>
                <span className="text-xs text-lime-400/50 font-mono">{result.duration_minutes} MIN</span>
              </div>
              <p className="text-xs text-lime-400/60 font-mono leading-relaxed">{result.narrative}</p>
            </div>
            <button
              onClick={() => setSessionOpen((o) => !o)}
              className="shrink-0 flex items-center gap-1 text-xs text-lime-400/40 hover:text-lime-400 font-mono uppercase tracking-widest transition-colors"
            >
              {sessionOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {sessionOpen ? 'HIDE' : 'SHOW'}
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
