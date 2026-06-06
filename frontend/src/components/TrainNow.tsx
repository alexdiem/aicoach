import { useState } from 'react'
import clsx from 'clsx'
import { trainNow } from '../api/client'
import type { TrainNowResult } from '../api/client'
import type { SessionInterval, StructuredSession } from '../types'

// ─── Session text display ─────────────────────────────────────────────────────

function IntervalLine({ step }: { step: SessionInterval }) {
  const isRest = step.type === 'rest'
  return (
    <p className={clsx('text-sm leading-relaxed', isRest && 'opacity-50')} style={{ color: '#8C7B6B' }}>
      {isRest ? (
        <>Rest — {step.duration_minutes}min</>
      ) : (
        <>
          {step.rep !== undefined && `Rep ${step.rep}/${step.total_reps} — `}
          {step.duration_minutes}min
          {step.target && <span className="font-mono"> [{step.target}]</span>}
          {step.notes && <span> — {step.notes}</span>}
        </>
      )}
    </p>
  )
}

function SessionView({ session }: { session: StructuredSession }) {
  return (
    <div className="mt-4 space-y-1">
      {session.warmup_minutes > 0 && (
        <p className="text-sm leading-relaxed" style={{ color: '#8C7B6B' }}>
          Warmup — {session.warmup_minutes}min
          {session.warmup_notes && <span> — {session.warmup_notes}</span>}
        </p>
      )}
      {session.intervals.map((step, i) => <IntervalLine key={i} step={step} />)}
      {session.cooldown_minutes > 0 && (
        <p className="text-sm leading-relaxed" style={{ color: '#8C7B6B' }}>
          Cooldown — {session.cooldown_minutes}min
          {session.cooldown_notes && <span> — {session.cooldown_notes}</span>}
        </p>
      )}
    </div>
  )
}

const SPORTS = [
  { value: 'CYCLING', label: 'Cycling' },
  { value: 'RUNNING', label: 'Running' },
  { value: 'XC_SKIING', label: 'XC Skiing' },
]

const DURATIONS = [30, 45, 60, 75, 90, 120]

interface Props {
  athleteId: number
}

export default function TrainNow({ athleteId }: Props) {
  const [open, setOpen] = useState(false)
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
    <div>
      {/* Trigger label */}
      <p className="text-xs tracking-[0.2em] uppercase mb-2 font-normal" style={{ color: '#D62828' }}>
        Train Now
      </p>
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-sm underline underline-offset-4 transition-opacity hover:opacity-70"
        style={{ color: '#1A1A1A' }}
      >
        {open ? 'Close ↑' : 'Train now →'}
      </button>

      {open && (
        <div className="mt-6 space-y-4">
          {/* Sport */}
          <div className="flex items-baseline gap-6">
            <span className="text-xs tracking-widest uppercase w-20 shrink-0" style={{ color: '#8C7B6B' }}>Sport</span>
            <div className="flex gap-4">
              {SPORTS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setSport(s.value)}
                  className={clsx(
                    'text-sm transition-all',
                    sport === s.value
                      ? 'font-bold underline underline-offset-4'
                      : 'hover:underline hover:underline-offset-4',
                  )}
                  style={{ color: sport === s.value ? '#1A1A1A' : '#8C7B6B' }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Mode */}
          <div className="flex items-baseline gap-6">
            <span className="text-xs tracking-widest uppercase w-20 shrink-0" style={{ color: '#8C7B6B' }}>By</span>
            <div className="flex gap-4">
              {(['time', 'distance'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={clsx(
                    'text-sm capitalize transition-all',
                    mode === m
                      ? 'font-bold underline underline-offset-4'
                      : 'hover:underline hover:underline-offset-4',
                  )}
                  style={{ color: mode === m ? '#1A1A1A' : '#8C7B6B' }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Duration / distance */}
          {mode === 'time' ? (
            <div className="flex items-baseline gap-6">
              <span className="text-xs tracking-widest uppercase w-20 shrink-0" style={{ color: '#8C7B6B' }}>Duration</span>
              <div className="flex gap-3 flex-wrap">
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDuration(d)}
                    className={clsx(
                      'text-sm transition-all',
                      duration === d
                        ? 'font-bold underline underline-offset-4'
                        : 'hover:underline hover:underline-offset-4',
                    )}
                    style={{ color: duration === d ? '#1A1A1A' : '#8C7B6B' }}
                  >
                    {d}m
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-baseline gap-6">
              <span className="text-xs tracking-widest uppercase w-20 shrink-0" style={{ color: '#8C7B6B' }}>Distance</span>
              <div className="flex items-baseline gap-2">
                <input
                  type="number"
                  min={1}
                  max={200}
                  placeholder="0"
                  value={distance}
                  onChange={(e) => setDistance(e.target.value)}
                  className="w-16 bg-transparent border-b text-sm text-center focus:outline-none"
                  style={{ borderColor: '#8C7B6B', color: '#1A1A1A' }}
                />
                <span className="text-sm" style={{ color: '#8C7B6B' }}>km</span>
              </div>
            </div>
          )}

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className={clsx(
              'text-sm underline underline-offset-4 transition-opacity',
              !canGenerate && 'opacity-30 cursor-not-allowed',
            )}
            style={{ color: '#D62828' }}
          >
            {loading ? 'Building session…' : 'Generate →'}
          </button>

          {error && <p className="text-xs" style={{ color: '#D62828' }}>{error}</p>}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="mt-6">
          <div className="flex items-baseline gap-4">
            <span className="text-xs tracking-widest uppercase" style={{ color: '#D62828' }}>
              {workoutTypeLabel[result.workout_type] ?? result.workout_type}
            </span>
            <span className="text-xs" style={{ color: '#8C7B6B' }}>{result.duration_minutes} min</span>
          </div>
          <p className="text-sm leading-relaxed mt-1" style={{ color: '#1A1A1A' }}>
            {result.narrative}
          </p>
          {result.session && (
            <button
              onClick={() => setSessionOpen((o) => !o)}
              className="text-xs mt-2 underline underline-offset-2 transition-opacity hover:opacity-70"
              style={{ color: '#8C7B6B' }}
            >
              {sessionOpen ? 'Hide intervals ↑' : 'Show intervals ↓'}
            </button>
          )}
          {sessionOpen && result.session && <SessionView session={result.session} />}
        </div>
      )}
    </div>
  )
}
