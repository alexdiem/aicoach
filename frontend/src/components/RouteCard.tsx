import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { Route } from '../types'
import { getAthleteId, setRouteRange } from '../api/client'

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
  onUpdate?: (updated: Route) => void
}

export default function RouteCard({ route, onDelete, onUpdate }: Props) {
  const athleteId = getAthleteId()!
  const [startKm, setStartKm] = useState<string>(route.start_km != null ? String(route.start_km) : '')
  const [endKm, setEndKm] = useState<string>(route.end_km != null ? String(route.end_km) : '')
  const [saving, setSaving] = useState(false)

  async function handleSaveRange() {
    setSaving(true)
    try {
      const updated = await setRouteRange(
        route.id,
        athleteId,
        startKm !== '' ? parseFloat(startKm) : null,
        endKm !== '' ? parseFloat(endKm) : null,
      )
      onUpdate?.(updated)
    } finally {
      setSaving(false)
    }
  }

  const hasRange = route.start_km != null || route.end_km != null
  const rangeLabel = hasRange
    ? `km ${route.start_km?.toFixed(1) ?? '0'} → ${route.end_km?.toFixed(1) ?? route.distance_km}`
    : 'Full route'

  // Segments with performance data (from performance_profile)
  const segmentsWithPerf: any[] = route.performance_profile?.segments_with_perf ?? []

  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-200 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{route.name}</h3>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
            <span>{route.distance_km} km</span>
            <span className="text-gray-300">·</span>
            <span>↑{route.elevation_gain_m}m</span>
            <span className="text-gray-300">·</span>
            <span>{route.gain_per_10km}m/10km</span>
            {route.source_file_type && (
              <>
                <span className="text-gray-300">·</span>
                <span className="uppercase">{route.source_file_type}</span>
              </>
            )}
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
        <span className="text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
          {route.terrain_type?.replace(/_/g, ' ').toLowerCase() ?? 'unknown terrain'}
        </span>
      </div>

      {route.segments.length > 0 && (
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Key segments</p>
          <div className="flex flex-col gap-1.5">
            {route.segments.slice(0, 4).map((seg, i) => {
              const cat = CATEGORY_LABELS[seg.category]
              const perf = segmentsWithPerf.find(
                (sp) => sp.start_km === seg.start_km && sp.end_km === seg.end_km,
              )
              return (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className={cat?.color ?? 'text-gray-400'}>{cat?.label ?? seg.category}</span>
                  <div className="flex items-center gap-2 text-gray-500 tabular-nums">
                    <span>
                      {seg.length_meters >= 1000
                        ? `${(seg.length_meters / 1000).toFixed(1)}km`
                        : `${seg.length_meters}m`}
                      {' '}@ {seg.avg_gradient_pct}% · ~{seg.est_duration_at_ftp_min}min
                    </span>
                    {perf?.avg_power_w && (
                      <span className="text-indigo-400">{perf.avg_power_w}W</span>
                    )}
                    {perf?.avg_hr_bpm && (
                      <span className="text-rose-400">{perf.avg_hr_bpm}bpm</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Training km range editor */}
      <div className="border-t border-gray-100 pt-3">
        <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">
          Training zone · <span className="text-gray-500 normal-case font-normal">{rangeLabel}</span>
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={route.distance_km}
            step={0.1}
            value={startKm}
            onChange={(e) => setStartKm(e.target.value)}
            placeholder="Start km"
            className="w-24 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-gray-900 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <span className="text-gray-400 text-xs">→</span>
          <input
            type="number"
            min={0}
            max={route.distance_km}
            step={0.1}
            value={endKm}
            onChange={(e) => setEndKm(e.target.value)}
            placeholder="End km"
            className="w-24 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-gray-900 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <button
            onClick={handleSaveRange}
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
