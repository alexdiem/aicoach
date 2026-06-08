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
  if (meters == null) return null
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

interface Props {
  activities: Activity[]
}

export default function ActivityFeed({ activities }: Props) {
  if (activities.length === 0) {
    return (
      <p className="text-gray-400 text-sm py-4 text-center">
        No activities yet. Connect Garmin and sync from Settings.
      </p>
    )
  }

  return (
    <div className="flex flex-col">
      {activities.map((a, i) => (
        <div
          key={a.id}
          className={`flex items-center gap-3 py-2.5 ${i < activities.length - 1 ? 'border-b border-gray-100' : ''}`}
        >
          <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center text-sm shrink-0">
            {TYPE_ICONS[a.activity_type] ?? '🏋️'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-900 capitalize">
                {a.activity_type.replace('_', ' ').toLowerCase()}
              </span>
              {a.sport_category === 'CASUAL' && (
                <span className="text-[10px] text-gray-400 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded-full">
                  casual
                </span>
              )}
            </div>
            <div className="text-[10px] text-gray-400 mt-0.5">
              {format(parseISO(a.start_time), 'EEE d MMM')}
              {' · '}
              {formatDuration(a.duration_seconds)}
              {formatDistance(a.distance_meters) && ` · ${formatDistance(a.distance_meters)}`}
              {a.elevation_gain_meters != null && ` · ↑${Math.round(a.elevation_gain_meters)}m`}
            </div>
          </div>
          <div className="text-right shrink-0">
            {a.training_stress_score != null ? (
              <div className="text-xs font-bold text-indigo-600 tabular-nums">
                {Math.round(a.training_stress_score)}
                <span className="text-gray-400 text-[10px] font-normal ml-0.5">TSS</span>
              </div>
            ) : null}
            {a.avg_heart_rate ? (
              <div className="text-[10px] text-gray-400 tabular-nums">{Math.round(a.avg_heart_rate)} bpm</div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}
