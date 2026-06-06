import type { PlannedWorkout } from '../types'

const SPORT_ICONS: Record<string, string> = {
  CYCLING: '🚴',
  RUNNING: '🏃',
  XC_SKIING: '⛷️',
  STRENGTH: '💪',
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  EASY:      { bg: 'rgba(74,222,128,0.1)',  text: '#4ADE80',  border: 'rgba(74,222,128,0.3)' },
  RECOVERY:  { bg: 'rgba(140,123,107,0.1)', text: '#8C7B6B',  border: 'rgba(140,123,107,0.3)' },
  TEMPO:     { bg: 'rgba(252,211,77,0.1)',  text: '#FCD34D',  border: 'rgba(252,211,77,0.3)' },
  THRESHOLD: { bg: 'rgba(245,158,11,0.1)',  text: '#F59E0B',  border: 'rgba(245,158,11,0.3)' },
  VO2MAX:    { bg: 'rgba(248,113,113,0.1)', text: '#F87171',  border: 'rgba(248,113,113,0.3)' },
  LONG:      { bg: 'rgba(56,189,248,0.1)',  text: '#38BDF8',  border: 'rgba(56,189,248,0.3)' },
  STRENGTH:  { bg: 'rgba(167,139,250,0.1)', text: '#A78BFA',  border: 'rgba(167,139,250,0.3)' },
}

const fallbackColor = { bg: 'rgba(140,123,107,0.1)', text: '#8C7B6B', border: 'rgba(140,123,107,0.3)' }

interface Props {
  workout: PlannedWorkout
  isToday?: boolean
  onMarkComplete?: (workout: PlannedWorkout) => void
}

export default function WorkoutCard({ workout, isToday, onMarkComplete }: Props) {
  const icon = SPORT_ICONS[workout.sport] ?? '🏋️'
  const colors = TYPE_COLORS[workout.workout_type] ?? fallbackColor
  const dayLabel = DAY_LABELS[workout.day_of_week] ?? ''

  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-3 min-w-[156px] max-w-[180px] transition-all"
      style={{
        backgroundColor: '#221C17',
        border: isToday ? '1px solid rgba(245,158,11,0.5)' : '1px solid #332820',
        opacity: workout.is_completed ? 0.55 : 1,
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: isToday ? '#F59E0B' : '#8C7B6B' }}
        >
          {isToday ? 'Today' : dayLabel}
        </span>
        {workout.is_completed && (
          <span className="text-xs font-semibold" style={{ color: '#4ADE80' }}>✓ Done</span>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        <span className="text-2xl leading-none">{icon}</span>
        <span
          className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ backgroundColor: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
        >
          {workout.workout_type}
        </span>
      </div>

      <div>
        <p className="text-sm font-bold" style={{ color: '#F5F0E8' }}>
          {workout.duration_minutes}
          <span className="font-normal text-xs ml-1" style={{ color: '#8C7B6B' }}>min</span>
          {workout.intensity_zone && (
            <span className="font-normal text-xs ml-1.5" style={{ color: '#8C7B6B' }}>{workout.intensity_zone}</span>
          )}
        </p>
        <p className="text-xs mt-1 line-clamp-2 leading-relaxed" style={{ color: '#8C7B6B' }}>{workout.purpose}</p>
      </div>

      {workout.terrain_notes && (
        <p className="text-xs line-clamp-1" style={{ color: 'rgba(245,158,11,0.7)' }}>
          ⛰ {workout.terrain_notes.slice(0, 60)}
        </p>
      )}

      {workout.compliance_score !== null && (
        <div className="flex items-center gap-1.5">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: colors.text }}
          />
          <span
            className="text-xs font-semibold"
            style={{
              color:
                workout.compliance_score >= 80 ? '#4ADE80'
                : workout.compliance_score >= 60 ? '#F59E0B'
                : '#F87171',
            }}
          >
            {workout.compliance_score}%
          </span>
          <span className="text-xs" style={{ color: '#8C7B6B' }}>compliance</span>
        </div>
      )}

      {!workout.is_completed && onMarkComplete && (
        <button
          onClick={() => onMarkComplete(workout)}
          className="text-xs font-medium text-left transition-opacity hover:opacity-70"
          style={{ color: '#F59E0B' }}
        >
          Mark complete →
        </button>
      )}
    </div>
  )
}
