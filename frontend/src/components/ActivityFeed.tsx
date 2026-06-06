import { format, parseISO } from 'date-fns'
import type { Activity } from '../types'

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}H${m}M` : `${m}M`
}

function formatDistance(meters: number | null) {
  if (!meters) return null
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)}KM` : `${Math.round(meters)}M`
}

interface Props {
  activities: Activity[]
}

export default function ActivityFeed({ activities }: Props) {
  if (activities.length === 0) {
    return (
      <p className="text-lime-400/40 text-xs font-mono py-4 text-center">
        NO ACTIVITIES YET. CONNECT GARMIN AND SYNC FROM SETTINGS.
      </p>
    )
  }

  return (
    <div className="font-mono">
      {/* Table header */}
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 pb-1 mb-1 border-b border-lime-400/30">
        <span className="text-[10px] text-lime-400/40 uppercase tracking-widest">TYPE</span>
        <span className="text-[10px] text-lime-400/40 uppercase tracking-widest">DATE</span>
        <span className="text-[10px] text-lime-400/40 uppercase tracking-widest">STATS</span>
        <span className="text-[10px] text-lime-400/40 uppercase tracking-widest text-right">TSS</span>
      </div>
      {activities.map((a) => (
        <div
          key={a.id}
          className="grid grid-cols-[1fr_auto_auto_auto] gap-4 py-2 border-b border-lime-400/10 last:border-0 items-center"
        >
          <div className="min-w-0">
            <span className="text-xs text-lime-400 font-mono uppercase">
              {a.activity_type.replace('_', ' ')}
            </span>
            {a.sport_category === 'CASUAL' && (
              <span className="ml-2 text-[9px] text-lime-400/30 font-mono border border-lime-400/20 px-1">CASUAL</span>
            )}
          </div>
          <span className="text-[10px] text-lime-400/50 font-mono tabular-nums whitespace-nowrap">
            {format(parseISO(a.start_time), 'EEE d MMM').toUpperCase()}
          </span>
          <div className="text-[10px] text-lime-400/50 font-mono whitespace-nowrap tabular-nums">
            {formatDuration(a.duration_seconds)}
            {formatDistance(a.distance_meters) && <span className="ml-1">{formatDistance(a.distance_meters)}</span>}
            {a.elevation_gain_meters && <span className="ml-1">+{Math.round(a.elevation_gain_meters)}M</span>}
            {a.avg_heart_rate && <span className="ml-1">{Math.round(a.avg_heart_rate)}BPM</span>}
          </div>
          <div className="text-right">
            {a.training_stress_score ? (
              <span className="text-sm font-bold text-lime-400 font-mono tabular-nums">
                {Math.round(a.training_stress_score)}
              </span>
            ) : (
              <span className="text-lime-400/20 text-xs font-mono">—</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
