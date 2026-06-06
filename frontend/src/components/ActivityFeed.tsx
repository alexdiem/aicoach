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
      <p className="text-zinc-600 text-xs py-4 text-center tracking-wide">
        No activities yet. Connect Garmin and sync from Settings.
      </p>
    )
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-zinc-600 uppercase tracking-widest border-b border-zinc-800">
          <th className="text-left pb-2 font-medium" style={{ fontSize: '9px' }}>Sport</th>
          <th className="text-left pb-2 font-medium" style={{ fontSize: '9px' }}>Date</th>
          <th className="text-right pb-2 font-medium" style={{ fontSize: '9px' }}>Duration</th>
          <th className="text-right pb-2 font-medium" style={{ fontSize: '9px' }}>Distance</th>
          <th className="text-right pb-2 font-medium" style={{ fontSize: '9px' }}>TSS</th>
          <th className="text-right pb-2 font-medium" style={{ fontSize: '9px' }}>HR</th>
        </tr>
      </thead>
      <tbody>
        {activities.map((a, i) => (
          <tr
            key={a.id}
            className={`transition-colors hover:bg-zinc-800/30 ${i < activities.length - 1 ? 'border-b border-zinc-800/50' : ''}`}
          >
            <td className="py-2.5 pr-3">
              <div className="flex items-center gap-2">
                <span>{TYPE_ICONS[a.activity_type] ?? '🏋️'}</span>
                <span className="text-zinc-300 capitalize">
                  {a.activity_type.replace('_', ' ').toLowerCase()}
                </span>
                {a.sport_category === 'CASUAL' && (
                  <span className="text-zinc-600" style={{ fontSize: '9px' }}>casual</span>
                )}
              </div>
            </td>
            <td className="py-2.5 pr-3 text-zinc-500 tabular-nums">
              {format(parseISO(a.start_time), 'EEE d MMM')}
            </td>
            <td className="py-2.5 text-right text-zinc-400 tabular-nums">
              {formatDuration(a.duration_seconds)}
            </td>
            <td className="py-2.5 pl-4 text-right text-zinc-500 tabular-nums">
              {formatDistance(a.distance_meters) ?? '—'}
              {a.elevation_gain_meters ? (
                <span className="text-zinc-600 ml-1">↑{Math.round(a.elevation_gain_meters)}m</span>
              ) : null}
            </td>
            <td className="py-2.5 pl-4 text-right tabular-nums font-bold" style={{ color: '#F59E0B' }}>
              {a.training_stress_score ? Math.round(a.training_stress_score) : '—'}
            </td>
            <td className="py-2.5 pl-4 text-right text-zinc-500 tabular-nums">
              {a.avg_heart_rate ? `${Math.round(a.avg_heart_rate)}` : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
