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
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: isRest ? '#1E1E35' : '#7C3AED' }}
        />
        <div className="w-px flex-1" style={{ backgroundColor: '#1E1E35' }} />
      </div>
      <div className="pb-3 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          {!isRest && step.rep !== undefined && (
            <span className="text-xs font-semibold text-white">Rep {step.rep}/{step.total_reps}</span>
          )}
          {isRest && <span className="text-xs font-semibold" style={{ color: '#6B6B8A' }}>Rest</span>}
          <span className="text-xs" style={{ color: '#6B6B8A' }}>{step.duration_minutes}min</span>
          {step.target && !isRest && <span className="text-xs font-mono" style={{ color: '#A78BFA' }}>{step.target}</span>}
        </div>
        <p className="text-xs mt-0.5 leading-relaxed" style={{ color: '#6B6B8A' }}>{step.notes}</p>
      </div>
    </div>
  )
}

function SessionView({ session }: { session: StructuredSession }) {
  return (
    <div className="pt-3 mt-2" style={{ borderTop: '1px solid #1E1E35' }}>
      {session.warmup_minutes > 0 && (
        <div className="flex gap-3 mb-1">
          <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
            <div className="w-2 h-2 rounded-full bg-emerald-600" />
            <div className="w-px flex-1" style={{ backgroundColor: '#1E1E35' }} />
          </div>
          <div className="pb-3">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold text-emerald-500">Warmup</span>
              <span className="text-xs" style={{ color: '#6B6B8A' }}>{session.warmup_minutes}min</span>
            </div>
            {session.warmup_notes && <p className="text-xs mt-0.5" style={{ color: '#6B6B8A' }}>{session.warmup_notes}</p>}
          </div>
        </div>
      )}
      {session.intervals.map((step, i) => <IntervalRow key={i} step={step} />)}
      {session.cooldown_minutes > 0 && (
        <div className="flex gap-3">
          <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#1E1E35' }} />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold" style={{ color: '#6B6B8A' }}>Cooldown</span>
              <span className="text-xs" style={{ color: '#6B6B8A' }}>{session.cooldown_minutes}min</span>
            </div>
            {session.cooldown_notes && <p className="text-xs mt-0.5" style={{ color: '#6B6B8A' }}>{session.cooldown_notes}</p>}
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
    <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: '#12121F', border: '1px solid #1E1E35' }}>
      <div className="p-4">
        <p className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: '#6B6B8A' }}>
          Train Now
        </p>

        {/* Sport selector */}
        <div className="flex gap-1.5 mb-3 flex-wrap">
          {SPORTS.map((s) => (
            <button
              key={s.value}
              onClick={() => setSport(s.value)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={
                sport === s.value
                  ? { backgroundColor: '#7C3AED', color: '#fff', border: '1px solid #7C3AED' }
                  : { backgroundColor: 'transparent', color: '#6B6B8A', border: '1px solid #1E1E35' }
              }
            >
              <span>{s.emoji}</span>
              {s.label}
            </button>
          ))}
        </div>

        {/* Time / distance toggle */}
        <div className="flex gap-1.5 mb-3">
          {(['time', 'distance'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all capitalize"
              style={
                mode === m
                  ? { backgroundColor: '#1E1E35', color: '#fff', border: '1px solid #1E1E35' }
                  : { backgroundColor: 'transparent', color: '#6B6B8A', border: '1px solid transparent' }
              }
            >
              {m === 'time' ? <Timer size={11} /> : <Ruler size={11} />}
              {m}
            </button>
          ))}
        </div>

        {mode === 'time' ? (
          <div className="flex gap-1.5 flex-wrap mb-4">
            {DURATIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDuration(d)}
                className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
                style={
                  duration === d
                    ? { backgroundColor: '#1E1E35', color: '#fff', border: '1px solid #1E1E35' }
                    : { backgroundColor: 'transparent', color: '#6B6B8A', border: '1px solid #1E1E35' }
                }
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
              className="w-20 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none"
              style={{ backgroundColor: '#1E1E35', border: '1px solid #1E1E35' }}
            />
            <span className="text-xs" style={{ color: '#6B6B8A' }}>km</span>
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all w-full justify-center',
          )}
          style={
            canGenerate
              ? { backgroundColor: '#7C3AED', color: '#fff' }
              : { backgroundColor: '#1E1E35', color: '#6B6B8A', cursor: 'not-allowed' }
          }
        >
          <Play size={12} className={loading ? 'animate-pulse' : ''} />
          {loading ? 'Building session…' : 'Generate session'}
        </button>

        {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
      </div>

      {/* Result */}
      {result && (
        <div style={{ borderTop: '1px solid #1E1E35' }}>
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#A78BFA' }}>
                  {workoutTypeLabel[result.workout_type] ?? result.workout_type}
                </span>
                <span style={{ color: '#1E1E35' }}>·</span>
                <span className="text-xs" style={{ color: '#6B6B8A' }}>{result.duration_minutes} min</span>
              </div>
              <p className="text-xs text-white leading-relaxed">{result.narrative}</p>
            </div>
            <button
              onClick={() => setSessionOpen((o) => !o)}
              className="shrink-0 flex items-center gap-1 text-xs transition-colors"
              style={{ color: '#6B6B8A' }}
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
