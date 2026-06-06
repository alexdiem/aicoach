import clsx from 'clsx'
import type { DayPreference } from '../api/client'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const OPTIONS = [
  { value: null,        label: 'Any (auto)',  icon: '✦' },
  { value: 'REST',      label: 'Rest day',    icon: '😴' },
  { value: 'CYCLING',   label: 'Cycling',     icon: '🚴' },
  { value: 'RUNNING',   label: 'Running',     icon: '🏃' },
  { value: 'XC_SKIING', label: 'Skiing',      icon: '⛷️' },
  { value: 'STRENGTH',  label: 'Strength',    icon: '💪' },
]

export interface DayState {
  value: string | null  // null = no preference, 'REST' = rest, else sport
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
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-7 gap-2">
        {DAYS.map((day, dow) => {
          const current = schedule[dow].value
          const isRest = current === 'REST'
          const hasSport = current !== null && current !== 'REST'

          return (
            <div key={dow} className="flex flex-col gap-1.5">
              <span className={clsx(
                'text-xs font-semibold text-center',
                isRest ? 'text-gray-600' : hasSport ? 'text-white' : 'text-gray-500'
              )}>
                {day}
              </span>
              <div className="relative">
                <select
                  value={current ?? ''}
                  onChange={(e) => setDay(dow, e.target.value === '' ? null : e.target.value)}
                  className={clsx(
                    'w-full appearance-none rounded-lg border px-2 py-2 text-xs font-medium cursor-pointer transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500',
                    isRest
                      ? 'bg-gray-900 border-gray-700 text-gray-500'
                      : hasSport
                        ? 'bg-blue-950 border-blue-700 text-blue-200'
                        : 'bg-gray-800 border-gray-700 text-gray-400',
                  )}
                >
                  {OPTIONS.map((opt) => (
                    <option key={opt.value ?? ''} value={opt.value ?? ''}>
                      {opt.icon} {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )
        })}
      </div>

      {hasAnyPreference && (
        <button
          onClick={reset}
          className="text-xs text-gray-600 hover:text-gray-400 transition-colors self-start"
        >
          Reset all to auto
        </button>
      )}
    </div>
  )
}

/** Convert SchedulePicker state to the DayPreference[] format the API expects */
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
