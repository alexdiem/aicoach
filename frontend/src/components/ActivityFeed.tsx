import { format, parseISO } from 'date-fns'
import type { Activity } from '../types'

const TYPE_ICONS: Record<string, string> = {
  CYCLING: '🚴',
  RUNNING: '🏃',
  XC_SKIING: '⛷️',
  HIKING: '🥾',
  CLIMBING: '🧗',
  STRENGTH: '💪',
  OTHER: '🏋️',
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function formatDistance(meters: number | null) {
  if (!meters) return null
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

interface Props {
  activities: Activity[]
}

export default function ActivityFeed({ activities }: Props) {
  if (activities.length === 0) {
    return (
      <p className="text-sm py-4 text-center" style={{ color: '#6B6B8A' }}>
        No activities yet. Connect Garmin and sync from Settings.
      </p>
    )
  }

  return (
    <div className="flex flex-col">
      {activities.map((a, i) => (
        <div
          key={a.id}
          className="flex items-center gap-3 py-2.5"
          style={i < activities.length - 1 ? { borderBottom: '1px solid #1E1E35' } : {}}
        >
          {/* Icon */}
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0"
            style={{ backgroundColor: '#1E1E35' }}
          >
            {TYPE_ICONS[a.activity_type] ?? '🏋️'}
          </div>

          {/* Name + meta */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white capitalize">
                {a.activity_type.replace('_', ' ').toLowerCase()}
              </span>
              {a.sport_category === 'CASUAL' && (
                <span
                  className="text-xs px-1.5 py-0.5 rounded-full"
                  style={{ color: '#6B6B8A', border: '1px solid #1E1E35', backgroundColor: '#12121F' }}
                >
                  casual
                </span>
              )}
            </div>
            <div className="text-xs mt-0.5 tabular-nums" style={{ color: '#6B6B8A' }}>
              {format(parseISO(a.start_time), 'EEE d MMM')}
              {' · '}
              {formatDuration(a.duration_seconds)}
              {formatDistance(a.distance_meters) && ` · ${formatDistance(a.distance_meters)}`}
              {a.elevation_gain_meters ? ` · ↑${Math.round(a.elevation_gain_meters)}m` : null}
            </div>
          </div>

          {/* Stats */}
          <div className="text-right shrink-0">
            {a.training_stress_score ? (
              <div className="text-sm font-bold tabular-nums" style={{ color: '#A78BFA' }}>
                {Math.round(a.training_stress_score)}
                <span className="text-xs font-normal ml-0.5" style={{ color: '#6B6B8A' }}>TSS</span>
              </div>
            ) : null}
            {a.avg_heart_rate ? (
              <div className="text-xs tabular-nums" style={{ color: '#6B6B8A' }}>
                {Math.round(a.avg_heart_rate)} bpm
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}
