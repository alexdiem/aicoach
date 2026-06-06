import { useState } from 'react'
import { Play, Timer, Ruler, ChevronDown, ChevronUp } from 'lucide-react'
import clsx from 'clsx'
import { trainNow } from '../api/client'
import type { TrainNowResult } from '../api/client'
import type { SessionInterval, StructuredSession } from '../types'

const glassCard: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  backdropFilter: 'blur(20px)',
  border: '1px solid rgba(255,255,255,0.08)',
}

function IntervalRow({ step }: { step: SessionInterval }) {
  const isRest = step.type === 'rest'
  return (
    <div className={clsx('flex gap-3', isRest && 'opacity-50')}>
      <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
        <div className={clsx('w-2 h-2 rounded-full shrink-0', isRest ? 'bg-white/20' : 'bg-blue-500')} />
        <div className="w-px flex-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
      </div>
      <div className="pb-3 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          {!isRest && step.rep !== undefined && (
            <span className="text-xs font-semibold text-white/60">Rep {step.rep}/{step.total_reps}</span>
          )}
          {isRest && <span className="text-xs font-semibold text-white/30">Rest</span>}
          <span className="text-xs text-white/30">{step.duration_minutes}min</span>
          {step.target && !isRest && <span className="text-xs font-mono text-blue-400">{step.target}</span>}
        </div>
        <p className="text-xs text-white/30 mt-0.5 leading-relaxed">{step.notes}</p>
      </div>
    </div>
  )
}

function SessionView({ session }: { session: StructuredSession }) {
  return (
    <div className="pt-3 mt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
      {session.warmup_minutes > 0 && (
        <div className="flex gap-3 mb-1">
          <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <div className="w-px flex-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
          </div>
          <div className="pb-3">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold text-emerald-500">Warmup</span>
              <span className="text-xs text-white/30">{session.warmup_minutes}min</span>
            </div>
            {session.warmup_notes && <p className="text-xs text-white/30 mt-0.5">{session.warmup_notes}</p>}
          </div>
        </div>
      )}
      {session.intervals.map((step, i) => <IntervalRow key={i} step={step} />)}
      {session.cooldown_minutes > 0 && (
        <div className="flex gap-3">
          <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
            <div className="w-2 h-2 rounded-full bg-white/20" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold text-white/30">Cooldown</span>
              <span className="text-xs text-white/30">{session.cooldown_minutes}min</span>
            </div>
            {session.cooldown_notes && <p className="text-xs text-white/30 mt-0.5">{session.cooldown_notes}</p>}
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
    <div className="rounded-2xl overflow-hidden" style={glassCard}>
      <div className="p-5">
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">Train Now</p>

        {/* Sport selector */}
        <div className="flex gap-2 mb-4">
          {SPORTS.map((s) => (
            <button
              key={s.value}
              onClick={() => setSport(s.value)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all',
                sport !== s.value && 'hover:text-white/80',
              )}
              style={
                sport === s.value
                  ? {
                      background: 'rgba(59,130,246,0.2)',
                      border: '1px solid rgba(59,130,246,0.5)',
                      color: '#fff',
                      boxShadow: '0 0 16px rgba(59,130,246,0.3)',
                    }
                  : {
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: 'rgba(255,255,255,0.4)',
                    }
              }
            >
              <span>{s.emoji}</span>
              {s.label}
            </button>
          ))}
        </div>

        {/* Time / distance toggle */}
        <div className="flex gap-2 mb-4">
          {(['time', 'distance'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                mode !== m && 'hover:text-white/60',
              )}
              style={
                mode === m
                  ? {
                      background: 'rgba(255,255,255,0.1)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      color: '#fff',
                    }
                  : {
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      color: 'rgba(255,255,255,0.3)',
                    }
              }
            >
              {m === 'time' ? <Timer size={12} /> : <Ruler size={12} />}
              {m === 'time' ? 'Time' : 'Distance'}
            </button>
          ))}
        </div>

        {mode === 'time' ? (
          <div className="flex gap-2 flex-wrap mb-4">
            {DURATIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDuration(d)}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                  duration !== d && 'hover:text-white/70',
                )}
                style={
                  duration === d
                    ? {
                        background: 'rgba(255,255,255,0.1)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        color: '#fff',
                      }
                    : {
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        color: 'rgba(255,255,255,0.35)',
                      }
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
              className="w-24 rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/20 focus:outline-none"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
            />
            <span className="text-sm text-white/30">km</span>
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
            !canGenerate && 'cursor-not-allowed opacity-40',
          )}
          style={
            canGenerate
              ? {
                  background: 'rgba(59,130,246,0.3)',
                  border: '1px solid rgba(59,130,246,0.5)',
                  color: '#fff',
                  boxShadow: '0 0 20px rgba(59,130,246,0.4)',
                }
              : {
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  color: 'rgba(255,255,255,0.3)',
                }
          }
        >
          <Play size={14} className={loading ? 'animate-pulse' : ''} />
          {loading ? 'Building session…' : 'Generate session'}
        </button>

        {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
      </div>

      {/* Result */}
      {result && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          {/* Summary bar */}
          <div className="px-5 py-4 flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">
                  {workoutTypeLabel[result.workout_type] ?? result.workout_type}
                </span>
                <span className="text-white/20">·</span>
                <span className="text-xs text-white/40">{result.duration_minutes} min</span>
              </div>
              <p className="text-sm text-white/60 leading-relaxed">{result.narrative}</p>
            </div>
            <button
              onClick={() => setSessionOpen((o) => !o)}
              className="shrink-0 flex items-center gap-1 text-xs text-white/40 hover:text-white/70 transition-colors"
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
