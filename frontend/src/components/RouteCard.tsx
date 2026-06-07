import { Trash2 } from 'lucide-react'
import type { Route } from '../types'

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  SHORT_PUNCH:  { label: 'Short punch',  color: 'text-rose-400' },
  MEDIUM_CLIMB: { label: 'Medium climb', color: 'text-orange-400' },
  LONG_CLIMB:   { label: 'Long climb',   color: 'text-amber-400' },
  ROLLING:      { label: 'Rolling',      color: 'text-blue-400' },
  FLAT:         { label: 'Flat',         color: 'text-gray-400' },
}

interface Props {
  route: Route
  onDelete?: (id: number) => void
}

export default function RouteCard({ route, onDelete }: Props) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-200 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-white truncate">{route.name}</h3>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
            <span>{route.distance_km} km</span>
            <span className="text-gray-300">·</span>
            <span>↑{route.elevation_gain_m}m</span>
            <span className="text-gray-300">·</span>
            <span>{route.gain_per_10km}m/10km</span>
          </div>
        </div>
        {onDelete && (
          <button
            onClick={() => onDelete(route.id)}
            className="text-gray-400 hover:text-rose-500 transition-colors p-1 shrink-0"
            title="Delete route"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <div>
        <span className="text-xs font-medium text-blue-400 bg-blue-950/40 border border-blue-900/60 px-2 py-0.5 rounded-full">
          {route.terrain_type?.replace(/_/g, ' ').toLowerCase() ?? 'unknown terrain'}
        </span>
      </div>

      {route.segments.length > 0 && (
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Key segments</p>
          <div className="flex flex-col gap-1.5">
            {route.segments.slice(0, 4).map((seg, i) => {
              const cat = CATEGORY_LABELS[seg.category]
              return (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className={cat?.color ?? 'text-gray-400'}>{cat?.label ?? seg.category}</span>
                  <span className="text-gray-500 tabular-nums">
                    {seg.length_meters >= 1000
                      ? `${(seg.length_meters / 1000).toFixed(1)}km`
                      : `${seg.length_meters}m`}
                    {' '}@ {seg.avg_gradient_pct}% · ~{seg.est_duration_at_ftp_min}min
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
