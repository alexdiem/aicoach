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
    return <p className="text-gray-500 text-sm py-4">No activities yet. Connect Garmin and sync.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {activities.map((a) => (
        <div key={a.id} className="flex items-center gap-3 py-2 border-b border-gray-800 last:border-0">
          <span className="text-xl">{TYPE_ICONS[a.activity_type] ?? '🏋️'}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white capitalize">
                {a.activity_type.replace('_', ' ').toLowerCase()}
              </span>
              {a.sport_category === 'CASUAL' && (
                <span className="text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">casual</span>
              )}
            </div>
            <div className="text-xs text-gray-500">
              {format(parseISO(a.start_time), 'EEE MMM d')}
              {' · '}
              {formatDuration(a.duration_seconds)}
              {formatDistance(a.distance_meters) && ` · ${formatDistance(a.distance_meters)}`}
              {a.elevation_gain_meters && ` · ↑${Math.round(a.elevation_gain_meters)}m`}
            </div>
          </div>
          <div className="text-right shrink-0">
            {a.training_stress_score && (
              <div className="text-sm font-semibold text-blue-400">{Math.round(a.training_stress_score)} TSS</div>
            )}
            {a.avg_heart_rate && (
              <div className="text-xs text-gray-500">{Math.round(a.avg_heart_rate)} bpm</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
