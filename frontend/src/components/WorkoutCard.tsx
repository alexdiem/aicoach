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
  EASY:      { dot: 'bg-emerald-500', badge: 'bg-emerald-950 text-emerald-400 border-emerald-900' },
  RECOVERY:  { dot: 'bg-zinc-500',    badge: 'bg-zinc-800 text-zinc-400 border-zinc-700' },
  TEMPO:     { dot: 'bg-yellow-500',  badge: 'bg-yellow-950 text-yellow-400 border-yellow-900' },
  THRESHOLD: { dot: 'bg-orange-500',  badge: 'bg-orange-950 text-orange-400 border-orange-900' },
  VO2MAX:    { dot: 'bg-rose-500',    badge: 'bg-rose-950 text-rose-400 border-rose-900' },
  LONG:      { dot: 'bg-blue-500',    badge: 'bg-blue-950 text-blue-400 border-blue-900' },
  STRENGTH:  { dot: 'bg-violet-500',  badge: 'bg-violet-950 text-violet-400 border-violet-900' },
}

const fallbackStyle = { dot: 'bg-zinc-600', badge: 'bg-zinc-800 text-zinc-400 border-zinc-700' }

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
        'rounded-2xl p-4 border flex flex-col gap-3 min-w-[156px] max-w-[180px] transition-all',
        isToday
          ? 'bg-zinc-900 border-blue-500/60 shadow-[0_0_0_1px_rgba(59,130,246,0.15)]'
          : 'bg-zinc-900 border-zinc-800',
        workout.is_completed && 'opacity-50',
      )}
    >
      <div className="flex items-center justify-between">
        <span className={clsx('text-xs font-semibold uppercase tracking-wider', isToday ? 'text-blue-400' : 'text-zinc-500')}>
          {isToday ? 'Today' : dayLabel}
        </span>
        {workout.is_completed && (
          <span className="text-emerald-400 text-xs font-semibold">✓ Done</span>
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
        <p className="text-sm font-bold text-white">
          {workout.duration_minutes}
          <span className="text-zinc-400 font-normal text-xs ml-1">min</span>
          {workout.intensity_zone && (
            <span className="text-zinc-500 font-normal text-xs ml-1.5">{workout.intensity_zone}</span>
          )}
        </p>
        <p className="text-xs text-zinc-500 mt-1 line-clamp-2 leading-relaxed">{workout.purpose}</p>
      </div>

      {workout.terrain_notes && (
        <p className="text-xs text-amber-400/80 line-clamp-1">⛰ {workout.terrain_notes.slice(0, 60)}</p>
      )}

      {workout.compliance_score !== null && (
        <div className="flex items-center gap-1.5">
          <div className={clsx('w-1.5 h-1.5 rounded-full', style.dot)} />
          <span
            className={clsx(
              'text-xs font-semibold',
              workout.compliance_score >= 80
                ? 'text-emerald-400'
                : workout.compliance_score >= 60
                  ? 'text-yellow-400'
                  : 'text-rose-400',
            )}
          >
            {workout.compliance_score}%
          </span>
          <span className="text-zinc-600 text-xs">compliance</span>
        </div>
      )}

      {!workout.is_completed && onMarkComplete && (
        <button
          onClick={() => onMarkComplete(workout)}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors font-medium text-left"
        >
          Mark complete →
        </button>
      )}
    </div>
  )
}
