import clsx from 'clsx'
import type { PlannedWorkout } from '../types'

const SPORT_ICONS: Record<string, string> = {
  CYCLING: '🚴',
  RUNNING: '🏃',
  XC_SKIING: '⛷️',
  STRENGTH: '💪',
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const TYPE_BADGE: Record<string, React.CSSProperties> = {
  EASY:      { background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#34d399' },
  RECOVERY:  { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' },
  TEMPO:     { background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.3)', color: '#fbbf24' },
  THRESHOLD: { background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.3)', color: '#fb923c' },
  VO2MAX:    { background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' },
  LONG:      { background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)', color: '#60a5fa' },
  STRENGTH:  { background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)', color: '#a78bfa' },
}

const TYPE_DOT_COLOR: Record<string, string> = {
  EASY: '#34d399', RECOVERY: 'rgba(255,255,255,0.3)', TEMPO: '#fbbf24',
  THRESHOLD: '#fb923c', VO2MAX: '#f87171', LONG: '#60a5fa', STRENGTH: '#a78bfa',
}

const fallbackBadge: React.CSSProperties = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)' }

interface Props {
  workout: PlannedWorkout
  isToday?: boolean
  onMarkComplete?: (workout: PlannedWorkout) => void
}

export default function WorkoutCard({ workout, isToday, onMarkComplete }: Props) {
  const icon = SPORT_ICONS[workout.sport] ?? '🏋️'
  const badge = TYPE_BADGE[workout.workout_type] ?? fallbackBadge
  const dotColor = TYPE_DOT_COLOR[workout.workout_type] ?? 'rgba(255,255,255,0.3)'
  const dayLabel = DAY_LABELS[workout.day_of_week] ?? ''

  const cardStyle: React.CSSProperties = isToday
    ? {
        background: 'rgba(59,130,246,0.08)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(59,130,246,0.4)',
        boxShadow: '0 0 20px rgba(59,130,246,0.15)',
      }
    : {
        background: 'rgba(255,255,255,0.04)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.08)',
      }

  return (
    <div
      className={clsx(
        'rounded-2xl p-4 flex flex-col gap-3 min-w-[156px] max-w-[180px] transition-all',
        workout.is_completed && 'opacity-50',
      )}
      style={cardStyle}
    >
      <div className="flex items-center justify-between">
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: isToday ? '#60a5fa' : 'rgba(255,255,255,0.35)' }}
        >
          {isToday ? 'Today' : dayLabel}
        </span>
        {workout.is_completed && (
          <span className="text-emerald-400 text-xs font-semibold">✓ Done</span>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        <span className="text-2xl leading-none">{icon}</span>
        <div className="flex flex-col gap-1">
          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={badge}>
            {workout.workout_type}
          </span>
        </div>
      </div>

      <div>
        <p className="text-sm font-bold text-white">
          {workout.duration_minutes}
          <span className="text-white/40 font-normal text-xs ml-1">min</span>
          {workout.intensity_zone && (
            <span className="text-white/30 font-normal text-xs ml-1.5">{workout.intensity_zone}</span>
          )}
        </p>
        <p className="text-xs text-white/40 mt-1 line-clamp-2 leading-relaxed">{workout.purpose}</p>
      </div>

      {workout.terrain_notes && (
        <p className="text-xs text-amber-400/70 line-clamp-1">⛰ {workout.terrain_notes.slice(0, 60)}</p>
      )}

      {workout.compliance_score !== null && (
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: dotColor }} />
          <span
            className="text-xs font-semibold"
            style={{
              color:
                workout.compliance_score >= 80 ? '#34d399'
                : workout.compliance_score >= 60 ? '#fbbf24'
                : '#f87171',
            }}
          >
            {workout.compliance_score}%
          </span>
          <span className="text-white/25 text-xs">compliance</span>
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
