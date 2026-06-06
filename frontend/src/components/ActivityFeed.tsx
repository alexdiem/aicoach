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
  /** When true, renders as a compact card suitable for the chat feed */
  compact?: boolean
}

export default function ActivityFeed({ activities, compact }: Props) {
  if (activities.length === 0) {
    return (
      <p className="text-[#8B949E] text-xs py-3 text-center">
        No activities yet. Connect Garmin and sync from Settings.
      </p>
    )
  }

  if (compact) {
    // Show only the 3 most recent in a compact card
    const recent = activities.slice(0, 3)
    return (
      <div
        className="rounded-xl border overflow-hidden"
        style={{ backgroundColor: '#161B22', borderColor: '#30363D' }}
      >
        {recent.map((a, i) => (
          <div
            key={a.id}
            className="flex items-center gap-2.5 px-3 py-2"
            style={i < recent.length - 1 ? { borderBottom: '1px solid #30363D' } : undefined}
          >
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0"
              style={{ backgroundColor: '#0D1117' }}
            >
              {TYPE_ICONS[a.activity_type] ?? '🏋️'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium capitalize" style={{ color: '#E6EDF3' }}>
                  {a.activity_type.replace('_', ' ').toLowerCase()}
                </span>
                {a.sport_category === 'CASUAL' && (
                  <span
                    className="text-[10px] px-1 py-0.5 rounded-full border"
                    style={{ color: '#8B949E', borderColor: '#30363D' }}
                  >
                    casual
                  </span>
                )}
              </div>
              <div className="text-[10px] text-[#8B949E] mt-0.5">
                {format(parseISO(a.start_time), 'EEE d MMM')}
                {' · '}
                {formatDuration(a.duration_seconds)}
                {formatDistance(a.distance_meters) && ` · ${formatDistance(a.distance_meters)}`}
              </div>
            </div>
            {a.training_stress_score ? (
              <div className="text-xs font-bold tabular-nums shrink-0" style={{ color: '#58A6FF' }}>
                {Math.round(a.training_stress_score)}
                <span className="text-[10px] font-normal ml-0.5" style={{ color: '#484F58' }}>TSS</span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {activities.map((a, i) => (
        <div
          key={a.id}
          className={`flex items-center gap-3 py-3 ${i < activities.length - 1 ? 'border-b border-[#30363D]' : ''}`}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0"
            style={{ backgroundColor: '#161B22' }}
          >
            {TYPE_ICONS[a.activity_type] ?? '🏋️'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium capitalize" style={{ color: '#E6EDF3' }}>
                {a.activity_type.replace('_', ' ').toLowerCase()}
              </span>
              {a.sport_category === 'CASUAL' && (
                <span
                  className="text-xs border px-1.5 py-0.5 rounded-full"
                  style={{ color: '#8B949E', borderColor: '#30363D' }}
                >
                  casual
                </span>
              )}
            </div>
            <div className="text-xs text-[#8B949E] mt-0.5">
              {format(parseISO(a.start_time), 'EEE d MMM')}
              {' · '}
              {formatDuration(a.duration_seconds)}
              {formatDistance(a.distance_meters) && ` · ${formatDistance(a.distance_meters)}`}
              {a.elevation_gain_meters && ` · ↑${Math.round(a.elevation_gain_meters)}m`}
            </div>
          </div>
          <div className="text-right shrink-0">
            {a.training_stress_score ? (
              <div className="text-sm font-bold tabular-nums" style={{ color: '#58A6FF' }}>
                {Math.round(a.training_stress_score)}
                <span className="text-xs font-normal ml-0.5 text-[#484F58]">TSS</span>
              </div>
            ) : null}
            {a.avg_heart_rate ? (
              <div className="text-xs tabular-nums text-[#8B949E]">{Math.round(a.avg_heart_rate)} bpm</div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}
