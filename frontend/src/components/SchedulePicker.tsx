import clsx from 'clsx'
import type { DayPreference } from '../api/client'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const OPTIONS = [
  { value: null,        label: 'Auto',     icon: '✦' },
  { value: 'REST',      label: 'Rest',     icon: '😴' },
  { value: 'CYCLING',   label: 'Cycling',  icon: '🚴' },
  { value: 'RUNNING',   label: 'Running',  icon: '🏃' },
  { value: 'XC_SKIING', label: 'Skiing',   icon: '⛷️' },
  { value: 'STRENGTH',  label: 'Strength', icon: '💪' },
]

export interface DayState {
  value: string | null
}

interface Props {
  schedule: DayState[]
  onChange: (schedule: DayState[]) => void
}

export default function SchedulePicker({ schedule, onChange }: Props) {
  function setDay(dow: number, value: string | null) {
    const updated = [...schedule]
    updated[dow] = { value }
    onChange(updated)
  }

  function reset() {
    onChange(Array.from({ length: 7 }, () => ({ value: null })))
  }

  const hasAnyPreference = schedule.some((s) => s.value !== null)

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-7 gap-2">
        {DAYS.map((day, dow) => {
          const current = schedule[dow].value
          const isRest = current === 'REST'
          const hasSport = current !== null && current !== 'REST'

          return (
            <div key={dow} className="flex flex-col gap-1.5">
              <span className={clsx(
                'text-xs font-semibold text-center',
                isRest ? 'text-gray-300' : hasSport ? 'text-gray-800' : 'text-gray-400'
              )}>
                {day}
              </span>
              <select
                value={current ?? ''}
                onChange={(e) => setDay(dow, e.target.value === '' ? null : e.target.value)}
                className={clsx(
                  'w-full appearance-none rounded-lg border px-1.5 py-1.5 text-xs font-medium cursor-pointer transition-colors focus:outline-none focus:ring-1 focus:ring-indigo-500 text-center',
                  isRest
                    ? 'bg-gray-100 border-gray-200 text-gray-300'
                    : hasSport
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                      : 'bg-white border-gray-200 text-gray-500',
                )}
              >
                {OPTIONS.map((opt) => (
                  <option key={opt.value ?? ''} value={opt.value ?? ''}>
                    {opt.icon} {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )
        })}
      </div>

      {hasAnyPreference && (
        <button
          onClick={reset}
          className="text-xs text-gray-400 hover:text-gray-700 transition-colors self-start"
        >
          Reset all to auto
        </button>
      )}
    </div>
  )
}

export function toApiSchedule(schedule: DayState[]): DayPreference[] {
  return schedule
    .map((s, dow) => {
      if (s.value === null) return null
      return {
        day_of_week: dow,
        is_rest: s.value === 'REST',
        preferred_sport: s.value === 'REST' ? null : s.value,
      }
    })
    .filter(Boolean) as DayPreference[]
}
