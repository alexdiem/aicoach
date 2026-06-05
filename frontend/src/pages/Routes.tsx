import { useEffect, useRef, useState } from 'react'
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
    if (file?.name.endsWith('.gpx')) {
      setPendingFile(file)
      setUploadName(file.name.replace('.gpx', ''))
    }
  }

  async function handleUpload() {
    if (!pendingFile || !uploadName.trim()) return
    setUploading(true)
    try {
      const route = await uploadRoute(athleteId, uploadName.trim(), pendingFile)
      setRoutes((prev) => [route as unknown as Route, ...prev])
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
    <div className="max-w-4xl mx-auto flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-white">Route Library</h1>

      {/* Upload zone */}
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
          dragOver ? 'border-blue-500 bg-blue-950/30' : 'border-gray-700 hover:border-gray-600'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".gpx"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) { setPendingFile(file); setUploadName(file.name.replace('.gpx', '')) }
          }}
        />
        <div className="text-4xl mb-3">🗺️</div>
        <p className="text-gray-400">Drop a GPX file here, or click to browse</p>
        <p className="text-gray-600 text-sm mt-1">Routes are analyzed for climb segments and matched to workouts</p>
      </div>

      {pendingFile && (
        <div className="bg-gray-900 rounded-xl p-4 border border-blue-800 flex items-center gap-3">
          <div className="flex-1">
            <p className="text-sm text-gray-400 mb-2">Route name:</p>
            <input
              value={uploadName}
              onChange={(e) => setUploadName(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm w-full"
              placeholder="e.g. Holmenkollen loop"
            />
          </div>
          <button
            onClick={handleUpload}
            disabled={uploading || !uploadName.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          >
            {uploading ? 'Analyzing…' : 'Upload & Analyze'}
          </button>
          <button onClick={() => setPendingFile(null)} className="text-gray-500 hover:text-gray-300 px-2">
            ✕
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-gray-500 text-center py-8">Loading routes…</div>
      ) : routes.length === 0 ? (
        <div className="text-center py-12 text-gray-600">
          <p>No routes yet. Upload a GPX file to get started.</p>
          <p className="text-sm mt-2">The app will analyze climb segments and match routes to your planned intervals.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {routes.map((r) => (
            <RouteCard key={r.id} route={r} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  )
}
