import clsx from 'clsx'
import type { PlannedWorkout } from '../types'

const SPORT_ICONS: Record<string, string> = {
  CYCLING: '🚴',
  RUNNING: '🏃',
  XC_SKIING: '⛷️',
  STRENGTH: '💪',
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const TYPE_COLORS: Record<string, string> = {
  EASY: 'bg-green-900 text-green-300',
  RECOVERY: 'bg-gray-800 text-gray-400',
  TEMPO: 'bg-yellow-900 text-yellow-300',
  THRESHOLD: 'bg-orange-900 text-orange-300',
  VO2MAX: 'bg-red-900 text-red-300',
  LONG: 'bg-blue-900 text-blue-300',
  STRENGTH: 'bg-purple-900 text-purple-300',
}

interface Props {
  workout: PlannedWorkout
  isToday?: boolean
  onMarkComplete?: (workout: PlannedWorkout) => void
}

export default function WorkoutCard({ workout, isToday, onMarkComplete }: Props) {
  const icon = SPORT_ICONS[workout.sport] ?? '🏋️'
  const typeColor = TYPE_COLORS[workout.workout_type] ?? 'bg-gray-800 text-gray-400'
  const dayLabel = DAY_LABELS[workout.day_of_week] ?? ''

  return (
    <div
      className={clsx(
        'bg-gray-900 rounded-xl p-4 border flex flex-col gap-2 min-w-[160px]',
        isToday ? 'border-blue-500' : 'border-gray-800',
        workout.is_completed && 'opacity-60',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase">{dayLabel}</span>
        {workout.is_completed && <span className="text-green-400 text-sm">✓</span>}
        {isToday && !workout.is_completed && (
          <span className="text-xs text-blue-400 font-medium">Today</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-2xl">{icon}</span>
        <div>
          <span className={clsx('text-xs px-2 py-0.5 rounded font-medium', typeColor)}>
            {workout.workout_type}
          </span>
        </div>
      </div>

      <div className="text-sm font-semibold text-white">
        {workout.duration_minutes}min
        {workout.intensity_zone && (
          <span className="text-gray-400 font-normal ml-1">{workout.intensity_zone}</span>
        )}
      </div>

      <p className="text-xs text-gray-400 line-clamp-2">{workout.purpose}</p>

      {workout.terrain_notes && (
        <p className="text-xs text-amber-400 line-clamp-1">🗺 {workout.terrain_notes.slice(0, 80)}</p>
      )}

      {workout.compliance_score !== null && (
        <div className="text-xs text-gray-500 mt-1">
          Compliance:{' '}
          <span
            className={clsx(
              'font-semibold',
              workout.compliance_score >= 80
                ? 'text-green-400'
                : workout.compliance_score >= 60
                  ? 'text-yellow-400'
                  : 'text-red-400',
            )}
          >
            {workout.compliance_score}%
          </span>
        </div>
      )}

      {!workout.is_completed && onMarkComplete && (
        <button
          onClick={() => onMarkComplete(workout)}
          className="mt-1 text-xs text-blue-400 hover:text-blue-300 transition-colors text-left"
        >
          Mark complete →
        </button>
      )}
    </div>
  )
}
