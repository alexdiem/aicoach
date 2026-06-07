import { useEffect, useRef, useState } from 'react'
import { Upload, X } from 'lucide-react'
import { getAthleteId, getRoutes, uploadRoute, deleteRoute } from '../api/client'
import RouteCard from '../components/RouteCard'
import type { Route } from '../types'

export default function RoutesPage() {
  const athleteId = getAthleteId()!
  const [routes, setRoutes] = useState<Route[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [uploadName, setUploadName] = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getRoutes(athleteId)
      .then(setRoutes)
      .finally(() => setLoading(false))
  }, [athleteId])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file?.name.match(/\.(gpx|fit)$/i)) {
      setPendingFile(file)
      setUploadName(file.name.replace(/\.(gpx|fit)$/i, ''))
    }
  }

  async function handleUpload() {
    if (!pendingFile || !uploadName.trim()) return
    setUploading(true)
    try {
      await uploadRoute(athleteId, uploadName.trim(), pendingFile)
      const updated = await getRoutes(athleteId)
      setRoutes(updated)
      setPendingFile(null)
      setUploadName('')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(id: number) {
    await deleteRoute(id, athleteId)
    setRoutes((prev) => prev.filter((r) => r.id !== id))
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Route Library</h1>
        <p className="text-sm text-gray-500 mt-0.5">Upload FIT or GPX activity files — routes are analysed for climbs and matched to planned intervals.</p>
      </div>

      {/* Upload zone */}
      <div
        className={`border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer ${
          dragOver
            ? 'border-indigo-400 bg-indigo-50'
            : 'border-gray-200 hover:border-gray-400'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".fit,.gpx"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) { setPendingFile(file); setUploadName(file.name.replace(/\.(gpx|fit)$/i, '')) }
          }}
        />
        <div className="w-10 h-10 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center mx-auto mb-3">
          <Upload size={18} className="text-gray-400" />
        </div>
        <p className="text-gray-700 text-sm font-medium">Drop a FIT or GPX activity file here</p>
        <p className="text-gray-400 text-xs mt-1">Exports from Garmin Connect, Strava, etc.</p>
      </div>

      {/* Pending upload */}
      {pendingFile && (
        <div className="bg-white rounded-2xl p-4 border border-indigo-200 flex items-center gap-3">
          <div className="flex-1">
            <p className="text-xs text-gray-500 mb-1.5">Route name</p>
            <input
              value={uploadName}
              onChange={(e) => setUploadName(e.target.value)}
              className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-900 text-sm w-full focus:outline-none focus:ring-1 focus:ring-indigo-400"
              placeholder="e.g. Holmenkollen loop"
            />
          </div>
          <button
            onClick={handleUpload}
            disabled={uploading || !uploadName.trim()}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors shrink-0"
          >
            {uploading ? 'Analysing…' : 'Upload'}
          </button>
          <button
            onClick={() => setPendingFile(null)}
            aria-label="Cancel upload"
            className="text-gray-400 hover:text-gray-700 transition-colors p-2"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-gray-400 text-sm text-center py-8">Loading routes…</div>
      ) : routes.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">No routes yet.</p>
          <p className="text-xs mt-1">Upload a GPX file to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {routes.map((r) => (
            <RouteCard
              key={r.id}
              route={r}
              onDelete={handleDelete}
              onUpdate={(updated) => setRoutes((prev) => prev.map((x) => x.id === updated.id ? updated : x))}
            />
          ))}
        </div>
      )}
    </div>
  )
}
