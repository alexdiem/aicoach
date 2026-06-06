import React, { useState } from 'react'
import { Play, Timer, Ruler, ChevronDown, ChevronUp } from 'lucide-react'
import clsx from 'clsx'
import { trainNow } from '../api/client'
import type { TrainNowResult } from '../api/client'
import type { SessionInterval, StructuredSession } from '../types'

function IntervalRow({ step, dark }: { step: SessionInterval; dark?: boolean }) {
  const isRest = step.type === 'rest'
  return (
    <div className={clsx('flex gap-3', isRest && 'opacity-50')}>
      <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
        <div className={clsx('w-2 h-2 rounded-full shrink-0', isRest ? (dark ? 'bg-slate-600' : 'bg-gray-400') : 'bg-white')} />
        <div className={clsx('w-px flex-1', dark ? 'bg-slate-700' : 'bg-gray-200')} />
      </div>
      <div className="pb-3 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          {!isRest && step.rep !== undefined && (
            <span className={clsx('text-xs font-semibold', dark ? 'text-slate-200' : 'text-gray-700')}>Rep {step.rep}/{step.total_reps}</span>
          )}
          {isRest && <span className={clsx('text-xs font-semibold', dark ? 'text-slate-500' : 'text-gray-400')}>Rest</span>}
          <span className={clsx('text-xs', dark ? 'text-slate-500' : 'text-gray-400')}>{step.duration_minutes}min</span>
          {step.target && !isRest && <span className={clsx('text-xs font-mono', dark ? 'text-slate-300' : 'text-gray-700')}>{step.target}</span>}
        </div>
        <p className={clsx('text-xs mt-0.5 leading-relaxed', dark ? 'text-slate-500' : 'text-gray-400')}>{step.notes}</p>
      </div>
    </div>
  )
}

function SessionView({ session, dark }: { session: StructuredSession; dark?: boolean }) {
  return (
    <div className={clsx('pt-3 border-t mt-2', dark ? 'border-slate-700' : 'border-gray-200')}>
      {session.warmup_minutes > 0 && (
        <div className="flex gap-3 mb-1">
          <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <div className={clsx('w-px flex-1', dark ? 'bg-slate-700' : 'bg-gray-200')} />
          </div>
          <div className="pb-3">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold text-emerald-500">Warmup</span>
              <span className={clsx('text-xs', dark ? 'text-slate-500' : 'text-gray-400')}>{session.warmup_minutes}min</span>
            </div>
            {session.warmup_notes && <p className={clsx('text-xs mt-0.5', dark ? 'text-slate-500' : 'text-gray-400')}>{session.warmup_notes}</p>}
          </div>
        </div>
      )}
      {session.intervals.map((step, i) => <IntervalRow key={i} step={step} dark={dark} />)}
      {session.cooldown_minutes > 0 && (
        <div className="flex gap-3">
          <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
            <div className={clsx('w-2 h-2 rounded-full', dark ? 'bg-slate-600' : 'bg-gray-300')} />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className={clsx('text-xs font-semibold', dark ? 'text-slate-500' : 'text-gray-400')}>Cooldown</span>
              <span className={clsx('text-xs', dark ? 'text-slate-600' : 'text-gray-400')}>{session.cooldown_minutes}min</span>
            </div>
            {session.cooldown_notes && <p className={clsx('text-xs mt-0.5', dark ? 'text-slate-600' : 'text-gray-400')}>{session.cooldown_notes}</p>}
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
  dark?: boolean
}

export default function TrainNow({ athleteId, dark }: Props) {
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
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-5 flex-1 overflow-y-auto">
        {/* Label */}
        <div className="flex items-center gap-1.5 mb-4">
          <span className="w-2 h-2 rounded-full bg-white shrink-0" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-white">Train Now</span>
        </div>

        {/* Sport selector */}
        <div className="flex gap-1.5 mb-3 flex-wrap">
          {SPORTS.map((s) => (
            <button
              key={s.value}
              onClick={() => setSport(s.value)}
              className={clsx(
                'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border',
                sport === s.value
                  ? 'bg-white border-white text-slate-900'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white hover:border-slate-500',
              )}
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
              'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border',
              mode === 'time'
                ? 'bg-white border-white text-slate-900'
                : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-white',
            )}
          >
            <Timer size={11} /> Time
          </button>
          <button
            onClick={() => setMode('distance')}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border',
              mode === 'distance'
                ? 'bg-white border-white text-slate-900'
                : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-white',
            )}
          >
            <Ruler size={11} /> Distance
          </button>
        </div>

        {mode === 'time' ? (
          <div className="flex gap-1.5 flex-wrap mb-4">
            {DURATIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDuration(d)}
                className={clsx(
                  'px-2.5 py-1 rounded-lg text-xs font-medium transition-all border',
                  duration === d
                    ? 'bg-white border-white text-slate-900'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white',
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
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDistance(e.target.value)}
              className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-white"
            />
            <span className="text-xs text-slate-500">km</span>
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all w-full justify-center',
            canGenerate
              ? 'bg-white hover:bg-gray-100 text-slate-900'
              : 'bg-slate-800 text-slate-600 cursor-not-allowed',
          )}
        >
          <Play size={13} className={loading ? 'animate-pulse' : ''} />
          {loading ? 'Building…' : 'Generate session'}
        </button>

        {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
      </div>

      {/* Result */}
      {result && (
        <div className="border-t border-slate-700">
          <div className="px-5 py-4 flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  {workoutTypeLabel[result.workout_type] ?? result.workout_type}
                </span>
                <span className="text-slate-600">·</span>
                <span className="text-xs text-slate-500">{result.duration_minutes} min</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">{result.narrative}</p>
            </div>
            <button
              onClick={() => setSessionOpen((o: boolean) => !o)}
              className="shrink-0 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              {sessionOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {sessionOpen ? 'Hide' : 'Show'}
            </button>
          </div>

          {sessionOpen && result.session && (
            <div className="px-5 pb-5">
              <SessionView session={result.session} dark={dark} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
