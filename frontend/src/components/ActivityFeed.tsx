import { format, parseISO } from 'date-fns'
import type { Activity } from '../types'

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
      <p className="text-sm py-4" style={{ color: '#8C7B6B' }}>
        No activities yet. Connect Garmin and sync from Settings.
      </p>
    )
  }

  return (
    <div className="flex flex-col">
      {activities.map((a) => {
        const parts: string[] = [
          format(parseISO(a.start_time), 'EEE d MMM'),
          formatDuration(a.duration_seconds),
        ]
        const dist = formatDistance(a.distance_meters)
        if (dist) parts.push(dist)
        if (a.elevation_gain_meters) parts.push(`↑${Math.round(a.elevation_gain_meters)}m`)
        if (a.training_stress_score) parts.push(`${Math.round(a.training_stress_score)} TSS`)
        if (a.avg_heart_rate) parts.push(`${Math.round(a.avg_heart_rate)} bpm`)

        return (
          <div
            key={a.id}
            className="flex items-baseline justify-between py-3 border-b border-gray-200 last:border-b-0"
          >
            <div className="flex-1 min-w-0">
              <span className="text-sm font-bold capitalize" style={{ color: '#1A1A1A' }}>
                {a.activity_type.replace('_', ' ').toLowerCase()}
              </span>
              {a.sport_category === 'CASUAL' && (
                <span className="ml-2 text-xs" style={{ color: '#8C7B6B' }}>casual</span>
              )}
            </div>
            <p className="text-xs text-right shrink-0 ml-4" style={{ color: '#8C7B6B' }}>
              {parts.join(' · ')}
            </p>
          </div>
        )
      })}
    </div>
  )
}
