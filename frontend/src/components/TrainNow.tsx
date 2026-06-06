import { useState } from 'react'
import { Play, Timer, Ruler, ChevronDown, ChevronUp } from 'lucide-react'
import clsx from 'clsx'
import { trainNow } from '../api/client'
import type { TrainNowResult } from '../api/client'
import type { SessionInterval, StructuredSession } from '../types'

function IntervalRow({ step }: { step: SessionInterval }) {
  const isRest = step.type === 'rest'
  return (
    <div className={clsx('flex gap-2.5', isRest && 'opacity-50')}>
      <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
        <div className={clsx('w-1.5 h-1.5 rounded-full shrink-0', isRest ? 'bg-[#30363D]' : 'bg-[#58A6FF]')} />
        <div className="w-px flex-1" style={{ backgroundColor: '#30363D' }} />
      </div>
      <div className="pb-2.5 min-w-0">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          {!isRest && step.rep !== undefined && (
            <span className="text-[11px] font-semibold" style={{ color: '#E6EDF3' }}>Rep {step.rep}/{step.total_reps}</span>
          )}
          {isRest && <span className="text-[11px] font-semibold text-[#8B949E]">Rest</span>}
          <span className="text-[11px] text-[#8B949E]">{step.duration_minutes}min</span>
          {step.target && !isRest && <span className="text-[11px] font-mono text-[#58A6FF]">{step.target}</span>}
        </div>
        <p className="text-[11px] text-[#8B949E] mt-0.5 leading-relaxed">{step.notes}</p>
      </div>
    </div>
  )
}

function SessionView({ session }: { session: StructuredSession }) {
  return (
    <div className="pt-2.5 mt-2" style={{ borderTop: '1px solid #30363D' }}>
      {session.warmup_minutes > 0 && (
        <div className="flex gap-2.5 mb-1">
          <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-700" />
            <div className="w-px flex-1" style={{ backgroundColor: '#30363D' }} />
          </div>
          <div className="pb-2.5">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[11px] font-semibold text-emerald-600">Warmup</span>
              <span className="text-[11px] text-[#8B949E]">{session.warmup_minutes}min</span>
            </div>
            {session.warmup_notes && <p className="text-[11px] text-[#8B949E] mt-0.5">{session.warmup_notes}</p>}
          </div>
        </div>
      )}
      {session.intervals.map((step, i) => <IntervalRow key={i} step={step} />)}
      {session.cooldown_minutes > 0 && (
        <div className="flex gap-2.5">
          <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#30363D' }} />
          </div>
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[11px] font-semibold text-[#484F58]">Cooldown</span>
              <span className="text-[11px] text-[#484F58]">{session.cooldown_minutes}min</span>
            </div>
            {session.cooldown_notes && <p className="text-[11px] text-[#484F58] mt-0.5">{session.cooldown_notes}</p>}
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
      className="rounded-xl border overflow-hidden"
      style={{ backgroundColor: '#161B22', borderColor: '#30363D' }}
    >
      <div className="p-3">
        {/* Sport selector */}
        <div className="flex gap-1.5 mb-3 flex-wrap">
          {SPORTS.map((s) => (
            <button
              key={s.value}
              onClick={() => setSport(s.value)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border"
              style={
                sport === s.value
                  ? { backgroundColor: '#58A6FF', borderColor: '#58A6FF', color: '#0D1117' }
                  : { backgroundColor: '#0D1117', borderColor: '#30363D', color: '#8B949E' }
              }
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
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border"
            style={
              mode === 'time'
                ? { backgroundColor: '#30363D', borderColor: '#484F58', color: '#E6EDF3' }
                : { backgroundColor: 'transparent', borderColor: '#30363D', color: '#484F58' }
            }
          >
            <Timer size={11} /> Time
          </button>
          <button
            onClick={() => setMode('distance')}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border"
            style={
              mode === 'distance'
                ? { backgroundColor: '#30363D', borderColor: '#484F58', color: '#E6EDF3' }
                : { backgroundColor: 'transparent', borderColor: '#30363D', color: '#484F58' }
            }
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
                className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all border"
                style={
                  duration === d
                    ? { backgroundColor: '#30363D', borderColor: '#484F58', color: '#E6EDF3' }
                    : { backgroundColor: 'transparent', borderColor: '#30363D', color: '#8B949E' }
                }
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
              className="w-20 rounded-lg px-2.5 py-1 text-xs focus:outline-none"
              style={{
                backgroundColor: '#0D1117',
                border: '1px solid #30363D',
                color: '#E6EDF3',
              }}
            />
            <span className="text-xs text-[#8B949E]">km</span>
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
          style={
            canGenerate
              ? { backgroundColor: '#58A6FF', color: '#0D1117' }
              : { backgroundColor: '#161B22', border: '1px solid #30363D', color: '#484F58', cursor: 'not-allowed' }
          }
        >
          <Play size={12} className={loading ? 'animate-pulse' : ''} />
          {loading ? 'Building session…' : 'Generate session'}
        </button>

        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
      </div>

      {/* Result — coach sends a follow-up "card" */}
      {result && (
        <div style={{ borderTop: '1px solid #30363D' }}>
          <div className="px-3 py-2.5 flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#58A6FF]">
                  {workoutTypeLabel[result.workout_type] ?? result.workout_type}
                </span>
                <span style={{ color: '#30363D' }}>·</span>
                <span className="text-[11px] text-[#8B949E]">{result.duration_minutes} min</span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: '#E6EDF3' }}>{result.narrative}</p>
            </div>
            <button
              onClick={() => setSessionOpen((o) => !o)}
              className="shrink-0 flex items-center gap-1 text-[11px] transition-colors"
              style={{ color: '#8B949E' }}
            >
              {sessionOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {sessionOpen ? 'Hide' : 'Show'}
            </button>
          </div>

          {sessionOpen && result.session && (
            <div className="px-3 pb-3">
              <SessionView session={result.session} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
