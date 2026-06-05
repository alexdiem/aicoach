import type { Route } from '../types'

const CATEGORY_LABELS: Record<string, string> = {
  SHORT_PUNCH: '⚡ Short punch',
  MEDIUM_CLIMB: '📈 Medium climb',
  LONG_CLIMB: '⛰️ Long climb',
  ROLLING: '〰️ Rolling',
  FLAT: '➡️ Flat',
}

interface Props {
  route: Route
  onDelete?: (id: number) => void
}

export default function RouteCard({ route, onDelete }: Props) {
  return (
    <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-white">{route.name}</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {route.distance_km} km · ↑{route.elevation_gain_m}m · {route.gain_per_10km}m/10km
          </p>
        </div>
        {onDelete && (
          <button
            onClick={() => onDelete(route.id)}
            className="text-gray-600 hover:text-red-400 text-lg transition-colors"
            title="Delete route"
          >
            ×
          </button>
        )}
      </div>

      <div className="text-xs text-blue-400 font-medium">
        {route.terrain_type?.replace('_', ' ').toLowerCase() ?? 'unknown terrain'}
      </div>

      {route.segments.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-1.5">Key segments:</p>
          <div className="flex flex-col gap-1">
            {route.segments.slice(0, 4).map((seg, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-gray-300">{CATEGORY_LABELS[seg.category] ?? seg.category}</span>
                <span className="text-gray-500">
                  {seg.length_meters >= 1000
                    ? `${(seg.length_meters / 1000).toFixed(1)}km`
                    : `${seg.length_meters}m`}{' '}
                  at {seg.avg_gradient_pct}% · ~{seg.est_duration_at_ftp_min}min FTP
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
