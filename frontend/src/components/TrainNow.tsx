import { useState } from 'react'
import { Play, Timer, Ruler, ChevronDown, ChevronUp } from 'lucide-react'
import { trainNow } from '../api/client'
import type { TrainNowResult } from '../api/client'
import type { SessionInterval, StructuredSession } from '../types'

function IntervalRow({ step }: { step: SessionInterval }) {
  const isRest = step.type === 'rest'
  return (
    <div className={`flex gap-3 ${isRest ? 'opacity-50' : ''}`}>
      <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: isRest ? '#332820' : '#F59E0B' }}
        />
        <div className="w-px flex-1" style={{ backgroundColor: '#332820' }} />
      </div>
      <div className="pb-3 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          {!isRest && step.rep !== undefined && (
            <span className="text-xs font-semibold" style={{ color: '#F5F0E8' }}>
              Rep {step.rep}/{step.total_reps}
            </span>
          )}
          {isRest && <span className="text-xs font-semibold" style={{ color: '#8C7B6B' }}>Rest</span>}
          <span className="text-xs" style={{ color: '#8C7B6B' }}>{step.duration_minutes}min</span>
          {step.target && !isRest && (
            <span className="text-xs font-mono" style={{ color: '#F59E0B' }}>{step.target}</span>
          )}
        </div>
        <p className="text-xs mt-0.5 leading-relaxed" style={{ color: '#8C7B6B' }}>{step.notes}</p>
      </div>
    </div>
  )
}

function SessionView({ session }: { session: StructuredSession }) {
  return (
    <div className="pt-3 mt-2" style={{ borderTop: '1px solid #332820' }}>
      {session.warmup_minutes > 0 && (
        <div className="flex gap-3 mb-1">
          <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#4ADE80' }} />
            <div className="w-px flex-1" style={{ backgroundColor: '#332820' }} />
          </div>
          <div className="pb-3">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold" style={{ color: '#4ADE80' }}>Warmup</span>
              <span className="text-xs" style={{ color: '#8C7B6B' }}>{session.warmup_minutes}min</span>
            </div>
            {session.warmup_notes && (
              <p className="text-xs mt-0.5" style={{ color: '#8C7B6B' }}>{session.warmup_notes}</p>
            )}
          </div>
        </div>
      )}
      {session.intervals.map((step, i) => <IntervalRow key={i} step={step} />)}
      {session.cooldown_minutes > 0 && (
        <div className="flex gap-3">
          <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#332820' }} />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold" style={{ color: '#8C7B6B' }}>Cooldown</span>
              <span className="text-xs" style={{ color: '#8C7B6B' }}>{session.cooldown_minutes}min</span>
            </div>
            {session.cooldown_notes && (
              <p className="text-xs mt-0.5" style={{ color: '#8C7B6B' }}>{session.cooldown_notes}</p>
            )}
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
    <div
      className="rounded-2xl overflow-hidden"
      style={{ backgroundColor: '#221C17', border: '1px solid #332820' }}
    >
      <div className="p-5">
        <p className="text-[10px] font-semibold uppercase tracking-wider mb-4" style={{ color: '#8C7B6B' }}>
          Train Now
        </p>

        {/* Sport selector */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {SPORTS.map((s) => (
            <button
              key={s.value}
              onClick={() => setSport(s.value)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all"
              style={{
                border: sport === s.value ? '1px solid rgba(245,158,11,0.5)' : '1px solid #332820',
                backgroundColor: sport === s.value ? 'rgba(245,158,11,0.12)' : 'transparent',
                color: sport === s.value ? '#F59E0B' : '#8C7B6B',
              }}
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                border: mode === m ? '1px solid #332820' : '1px solid transparent',
                backgroundColor: mode === m ? '#332820' : 'transparent',
                color: mode === m ? '#F5F0E8' : '#8C7B6B',
              }}
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
                className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
                style={{
                  border: duration === d ? '1px solid rgba(245,158,11,0.4)' : '1px solid #332820',
                  backgroundColor: duration === d ? 'rgba(245,158,11,0.1)' : 'transparent',
                  color: duration === d ? '#F59E0B' : '#8C7B6B',
                }}
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
              className="w-24 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
              style={{
                backgroundColor: '#1A1410',
                border: '1px solid #332820',
                color: '#F5F0E8',
              }}
            />
            <span className="text-sm" style={{ color: '#8C7B6B' }}>km</span>
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
          style={{
            backgroundColor: canGenerate ? '#F59E0B' : '#332820',
            color: canGenerate ? '#1A1410' : '#8C7B6B',
            cursor: canGenerate ? 'pointer' : 'not-allowed',
          }}
        >
          <Play size={14} className={loading ? 'animate-pulse' : ''} />
          {loading ? 'Building session…' : 'Generate session'}
        </button>

        {error && <p className="mt-3 text-xs" style={{ color: '#F87171' }}>{error}</p>}
      </div>

      {/* Result */}
      {result && (
        <div style={{ borderTop: '1px solid #332820' }}>
          <div className="px-5 py-4 flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#F59E0B' }}>
                  {workoutTypeLabel[result.workout_type] ?? result.workout_type}
                </span>
                <span style={{ color: '#332820' }}>·</span>
                <span className="text-xs" style={{ color: '#8C7B6B' }}>{result.duration_minutes} min</span>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: '#F5F0E8' }}>{result.narrative}</p>
            </div>
            <button
              onClick={() => setSessionOpen((o) => !o)}
              className="shrink-0 flex items-center gap-1 text-xs transition-colors"
              style={{ color: '#8C7B6B' }}
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
