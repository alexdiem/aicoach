import clsx from 'clsx'
import type { PlannedWorkout } from '../types'

const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

interface Props {
  workout: PlannedWorkout
  isToday?: boolean
  index?: number
  onMarkComplete?: (workout: PlannedWorkout) => void
}

export default function WorkoutCard({ workout, isToday, index = 0, onMarkComplete }: Props) {
  const dayLabel = DAY_LABELS[workout.day_of_week] ?? ''
  const num = String(index + 1).padStart(2, '0')

  return (
    <div
      className={clsx(
        'flex items-start gap-4 py-4 border-b border-gray-200 last:border-b-0',
        workout.is_completed && 'opacity-40',
      )}
    >
      {/* Number / today dot */}
      <div className="w-8 shrink-0 flex items-center justify-center pt-0.5">
        {isToday ? (
          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: '#D62828' }} />
        ) : (
          <span className="text-xs tabular-nums font-normal" style={{ color: '#8C7B6B' }}>{num}</span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1">
        <p className="text-sm font-bold leading-tight" style={{ color: '#1A1A1A' }}>
          {dayLabel} — {workout.workout_type} {workout.sport.replace('_', ' ')}{' '}
          <span className="font-normal" style={{ color: '#8C7B6B' }}>{workout.duration_minutes}min</span>
        </p>
        {workout.purpose && (
          <p className="text-xs mt-0.5 leading-snug" style={{ color: '#8C7B6B' }}>
            {workout.purpose}
          </p>
        )}
        {workout.terrain_notes && (
          <p className="text-xs mt-0.5" style={{ color: '#8C7B6B' }}>
            {workout.terrain_notes.slice(0, 80)}
          </p>
        )}
        {workout.compliance_score !== null && (
          <p className="text-xs mt-1" style={{ color: '#8C7B6B' }}>
            Compliance: {workout.compliance_score}%
          </p>
        )}
        {!workout.is_completed && onMarkComplete && (
          <button
            onClick={() => onMarkComplete(workout)}
            className="text-xs mt-1 underline underline-offset-2 transition-opacity hover:opacity-70"
            style={{ color: '#1A1A1A' }}
          >
            Mark complete →
          </button>
        )}
        {workout.is_completed && (
          <p className="text-xs mt-1" style={{ color: '#8C7B6B' }}>Done</p>
        )}
      </div>

      {/* Intensity zone */}
      {workout.intensity_zone && (
        <span className="text-xs shrink-0" style={{ color: '#8C7B6B' }}>
          {workout.intensity_zone}
        </span>
      )}
    </div>
  )
}
