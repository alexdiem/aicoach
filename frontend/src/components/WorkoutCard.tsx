import clsx from 'clsx'
import type { PlannedWorkout } from '../types'

const SPORT_LABELS: Record<string, string> = {
  CYCLING: 'CYC',
  RUNNING: 'RUN',
  XC_SKIING: 'SKI',
  STRENGTH: 'STR',
}

const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

interface Props {
  workout: PlannedWorkout
  isToday?: boolean
  onMarkComplete?: (workout: PlannedWorkout) => void
}

export default function WorkoutCard({ workout, isToday, onMarkComplete }: Props) {
  const sportLabel = SPORT_LABELS[workout.sport] ?? 'ACT'
  const dayLabel = DAY_LABELS[workout.day_of_week] ?? ''

  return (
    <div
      className={clsx(
        'border flex flex-col gap-2 min-w-[156px] max-w-[180px] p-4 font-mono transition-all',
        isToday
          ? 'border-lime-400 bg-black'
          : 'border-lime-400/20 bg-black',
        workout.is_completed && 'opacity-40',
      )}
    >
      {/* Day / status */}
      <div className="flex items-center justify-between">
        <span className={clsx('text-[10px] font-mono uppercase tracking-widest', isToday ? 'text-lime-400' : 'text-lime-400/40')}>
          {isToday ? 'TODAY' : dayLabel}
        </span>
        {workout.is_completed && (
          <span className="text-lime-400 text-[10px] font-mono">DONE</span>
        )}
      </div>

      {/* Sport + type */}
      <div>
        <span className="text-lime-400/50 text-[10px] font-mono mr-2">{sportLabel}</span>
        <span className="text-lime-400 text-xs font-mono font-semibold uppercase">{workout.workout_type}</span>
      </div>

      {/* Duration */}
      <div>
        <span className="text-2xl font-bold text-lime-400 font-mono tabular-nums">{workout.duration_minutes}</span>
        <span className="text-lime-400/40 text-xs font-mono ml-1">MIN</span>
        {workout.intensity_zone && (
          <span className="block text-[10px] text-lime-400/30 font-mono mt-0.5">{workout.intensity_zone}</span>
        )}
      </div>

      {/* Purpose */}
      <p className="text-[10px] text-lime-400/40 font-mono line-clamp-2 leading-relaxed">{workout.purpose}</p>

      {/* Terrain */}
      {workout.terrain_notes && (
        <p className="text-[10px] text-lime-400/30 font-mono line-clamp-1">{workout.terrain_notes.slice(0, 60)}</p>
      )}

      {/* Compliance */}
      {workout.compliance_score !== null && (
        <div className="flex items-center gap-1.5">
          <span
            className={clsx(
              'text-xs font-semibold font-mono',
              workout.compliance_score >= 80
                ? 'text-lime-400'
                : workout.compliance_score >= 60
                  ? 'text-lime-400/60'
                  : 'text-lime-400/30',
            )}
          >
            {workout.compliance_score}%
          </span>
          <span className="text-lime-400/20 text-[10px] font-mono">COMPLIANCE</span>
        </div>
      )}

      {/* Mark complete */}
      {!workout.is_completed && onMarkComplete && (
        <button
          onClick={() => onMarkComplete(workout)}
          className="text-[10px] font-mono text-lime-400/50 hover:bg-lime-400 hover:text-black px-2 py-1 border border-lime-400/30 transition-all text-left uppercase tracking-widest"
        >
          MARK COMPLETE
        </button>
      )}
    </div>
  )
}
