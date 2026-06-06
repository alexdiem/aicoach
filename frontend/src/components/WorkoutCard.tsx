import clsx from 'clsx'
import type { PlannedWorkout } from '../types'

const SPORT_ICONS: Record<string, string> = {
  CYCLING: '🚴',
  RUNNING: '🏃',
  XC_SKIING: '⛷️',
  STRENGTH: '💪',
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const TYPE_STYLES: Record<string, { dot: string; badge: string }> = {
  EASY:      { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  RECOVERY:  { dot: 'bg-gray-400',    badge: 'bg-gray-50 text-gray-500 border-gray-200' },
  TEMPO:     { dot: 'bg-yellow-500',  badge: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  THRESHOLD: { dot: 'bg-orange-500',  badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  VO2MAX:    { dot: 'bg-rose-500',    badge: 'bg-rose-50 text-rose-600 border-rose-200' },
  LONG:      { dot: 'bg-orange-600',  badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  STRENGTH:  { dot: 'bg-violet-500',  badge: 'bg-violet-50 text-violet-700 border-violet-200' },
}

const fallbackStyle = { dot: 'bg-gray-400', badge: 'bg-gray-50 text-gray-500 border-gray-200' }

interface Props {
  workout: PlannedWorkout
  isToday?: boolean
  onMarkComplete?: (workout: PlannedWorkout) => void
}

export default function WorkoutCard({ workout, isToday, onMarkComplete }: Props) {
  const icon = SPORT_ICONS[workout.sport] ?? '🏋️'
  const style = TYPE_STYLES[workout.workout_type] ?? fallbackStyle
  const dayLabel = DAY_LABELS[workout.day_of_week] ?? ''

  return (
    <div
      className={clsx(
        'rounded-xl p-4 border flex flex-col gap-3 min-w-[156px] max-w-[180px] transition-all bg-white shadow-sm',
        isToday
          ? 'border-orange-300 shadow-[0_0_0_1px_rgba(234,88,12,0.12)]'
          : 'border-gray-100',
        workout.is_completed && 'opacity-50',
      )}
    >
      <div className="flex items-center justify-between">
        <span className={clsx('text-xs font-semibold uppercase tracking-wider', isToday ? 'text-orange-600' : 'text-gray-400')}>
          {isToday ? 'Today' : dayLabel}
        </span>
        {workout.is_completed && (
          <span className="text-emerald-600 text-xs font-semibold">✓ Done</span>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        <span className="text-2xl leading-none">{icon}</span>
        <div className="flex flex-col gap-1">
          <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium', style.badge)}>
            {workout.workout_type}
          </span>
        </div>
      </div>

      <div>
        <p className="text-sm font-bold text-gray-900">
          {workout.duration_minutes}
          <span className="text-gray-400 font-normal text-xs ml-1">min</span>
          {workout.intensity_zone && (
            <span className="text-gray-400 font-normal text-xs ml-1.5">{workout.intensity_zone}</span>
          )}
        </p>
        <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">{workout.purpose}</p>
      </div>

      {workout.terrain_notes && (
        <p className="text-xs text-amber-600/80 line-clamp-1">⛰ {workout.terrain_notes.slice(0, 60)}</p>
      )}

      {workout.compliance_score !== null && (
        <div className="flex items-center gap-1.5">
          <div className={clsx('w-1.5 h-1.5 rounded-full', style.dot)} />
          <span
            className={clsx(
              'text-xs font-semibold',
              workout.compliance_score >= 80
                ? 'text-emerald-600'
                : workout.compliance_score >= 60
                  ? 'text-yellow-600'
                  : 'text-rose-500',
            )}
          >
            {workout.compliance_score}%
          </span>
          <span className="text-gray-400 text-xs">compliance</span>
        </div>
      )}

      {!workout.is_completed && onMarkComplete && (
        <button
          onClick={() => onMarkComplete(workout)}
          className="text-xs text-orange-600 hover:text-orange-700 transition-colors font-medium text-left"
        >
          Mark complete →
        </button>
      )}
    </div>
  )
}
