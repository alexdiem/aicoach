import clsx from 'clsx'
import type { PlannedWorkout } from '../types'

const SPORT_ICONS: Record<string, string> = {
  CYCLING: '🚴',
  RUNNING: '🏃',
  XC_SKIING: '⛷️',
  STRENGTH: '💪',
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Badge styles — rounded-full per design spec
const TYPE_BADGE: Record<string, string> = {
  EASY:      'bg-emerald-950 text-emerald-400',
  RECOVERY:  'bg-zinc-800 text-zinc-400',
  TEMPO:     'bg-yellow-950 text-yellow-400',
  THRESHOLD: 'bg-orange-950 text-orange-400',
  VO2MAX:    'bg-rose-950 text-rose-400',
  LONG:      'bg-blue-950 text-blue-400',
  STRENGTH:  'bg-violet-950 text-violet-400',
}

const fallbackBadge = 'bg-zinc-800 text-zinc-400'

interface Props {
  workout: PlannedWorkout
  isToday?: boolean
  onMarkComplete?: (workout: PlannedWorkout) => void
}

/** Compact day-row for the "This week" vertical list in the dashboard sidebar column. */
export default function WorkoutCard({ workout, isToday, onMarkComplete }: Props) {
  const icon = SPORT_ICONS[workout.sport] ?? '🏋️'
  const badgeCls = TYPE_BADGE[workout.workout_type] ?? fallbackBadge
  const dayLabel = DAY_LABELS[workout.day_of_week] ?? ''

  return (
    <div
      className={clsx(
        'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all',
        workout.is_completed && 'opacity-50',
      )}
      style={
        isToday
          ? { borderLeft: '2px solid #7C3AED', backgroundColor: 'rgba(124,58,237,0.08)' }
          : { borderLeft: '2px solid transparent' }
      }
    >
      {/* Day label */}
      <span
        className="text-xs font-semibold uppercase w-8 shrink-0"
        style={{ color: isToday ? '#A78BFA' : '#6B6B8A' }}
      >
        {isToday ? 'Now' : dayLabel}
      </span>

      {/* Sport icon */}
      <span className="text-base leading-none shrink-0">{icon}</span>

      {/* Type badge */}
      <span className={clsx('rounded-full px-2.5 py-0.5 text-xs font-semibold shrink-0', badgeCls)}>
        {workout.workout_type}
      </span>

      {/* Duration */}
      <span className="text-xs text-white font-medium ml-auto shrink-0">
        {workout.duration_minutes}
        <span style={{ color: '#6B6B8A' }} className="font-normal">m</span>
      </span>

      {/* Done check */}
      {workout.is_completed && (
        <span className="text-emerald-400 text-xs shrink-0">✓</span>
      )}

      {/* Mark complete */}
      {!workout.is_completed && onMarkComplete && isToday && (
        <button
          onClick={() => onMarkComplete(workout)}
          className="text-xs font-medium transition-colors shrink-0"
          style={{ color: '#A78BFA' }}
        >
          →
        </button>
      )}
    </div>
  )
}
