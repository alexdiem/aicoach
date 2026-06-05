import clsx from 'clsx'
import type { DayPreference } from '../api/client'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface SportOption {
  value: string | null
  label: string
  icon: string
  color: string
}

const OPTIONS: SportOption[] = [
  { value: null,        label: 'Any',      icon: '✦',  color: 'bg-gray-700 text-gray-300 border-gray-600' },
  { value: 'REST',      label: 'Rest',     icon: '😴', color: 'bg-gray-800 text-gray-500 border-gray-700' },
  { value: 'CYCLING',   label: 'Cycling',  icon: '🚴', color: 'bg-blue-900 text-blue-300 border-blue-700' },
  { value: 'RUNNING',   label: 'Running',  icon: '🏃', color: 'bg-green-900 text-green-300 border-green-700' },
  { value: 'XC_SKIING', label: 'Skiing',   icon: '⛷️', color: 'bg-sky-900 text-sky-300 border-sky-700' },
  { value: 'STRENGTH',  label: 'Strength', icon: '💪', color: 'bg-purple-900 text-purple-300 border-purple-700' },
]

interface DayState {
  // null = no preference, 'REST' = rest day, else sport name
  value: string | null
}

interface Props {
  schedule: DayState[]
  onChange: (schedule: DayState[]) => void
}

export default function SchedulePicker({ schedule, onChange }: Props) {
  function cycleDay(dow: number) {
    const current = schedule[dow].value
    const idx = OPTIONS.findIndex((o) => o.value === current)
    const next = OPTIONS[(idx + 1) % OPTIONS.length]
    const updated = [...schedule]
    updated[dow] = { value: next.value }
    onChange(updated)
  }

  function setDay(dow: number, value: string | null) {
    const updated = [...schedule]
    updated[dow] = { value }
    onChange(updated)
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-gray-500">
        Click a day to cycle through options, or pick from the dropdown. Leave as{' '}
        <span className="text-gray-300">Any</span> to let the plan decide.
      </p>
      <div className="grid grid-cols-7 gap-2">
        {DAYS.map((day, dow) => {
          const current = OPTIONS.find((o) => o.value === schedule[dow].value) ?? OPTIONS[0]
          return (
            <div key={dow} className="flex flex-col items-center gap-1.5">
              <span className="text-xs text-gray-500 font-medium">{day}</span>
              <button
                onClick={() => cycleDay(dow)}
                title="Click to cycle options"
                className={clsx(
                  'w-full aspect-square rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 transition-all hover:scale-105 active:scale-95',
                  current.color,
                )}
              >
                <span className="text-xl leading-none">{current.icon}</span>
                <span className="text-[10px] font-semibold leading-none">{current.label}</span>
              </button>
            </div>
          )
        })}
      </div>

      {/* Summary line */}
      <p className="text-xs text-gray-600">
        {schedule.map((s, i) => {
          const opt = OPTIONS.find((o) => o.value === s.value) ?? OPTIONS[0]
          return opt.value !== null ? (
            <span key={i} className="text-gray-400">
              {DAYS[i]}: {opt.label}
              {i < 6 ? ' · ' : ''}
            </span>
          ) : null
        })}
        {schedule.every((s) => s.value === null) && (
          <span className="italic">No preferences set — fully auto.</span>
        )}
      </p>
    </div>
  )
}

/** Convert SchedulePicker state to the DayPreference[] format the API expects */
export function toApiSchedule(schedule: DayState[]): DayPreference[] {
  return schedule
    .map((s, dow) => {
      if (s.value === null) return null // no preference → omit
      return {
        day_of_week: dow,
        is_rest: s.value === 'REST',
        preferred_sport: s.value === 'REST' ? null : s.value,
      }
    })
    .filter(Boolean) as DayPreference[]
}
