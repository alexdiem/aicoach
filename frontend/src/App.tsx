import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Plan from './pages/Plan'
import RoutesPage from './pages/Routes'
import Settings from './pages/Settings'
import { setAthleteId, getAthleteId, connectGarmin } from './api/client'

export default function App() {
  const [athleteId, setLocalAthleteId] = useState<number | null>(getAthleteId())
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConnect() {
    setConnecting(true)
    setError(null)
    try {
      const result = await connectGarmin()
      setAthleteId(result.athlete_id)
      setLocalAthleteId(result.athlete_id)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Connection failed'
      setError(`${msg}. Make sure GARMIN_EMAIL and GARMIN_PASSWORD are set in backend/.env`)
    } finally {
      setConnecting(false)
    }
  }

  if (!athleteId) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-6">
        <div className="text-center max-w-md">
          <h1 className="text-4xl font-bold text-white mb-2">aicoach</h1>
          <p className="text-gray-400 mb-8">Your cross-sport training planner</p>
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-8 py-3 rounded-lg font-semibold transition-colors"
          >
            {connecting ? 'Connecting…' : 'Connect Garmin Account'}
          </button>
          {error && (
            <p className="text-red-400 text-sm mt-4 text-left bg-red-950 p-3 rounded-lg">{error}</p>
          )}
          <p className="text-gray-600 text-sm mt-6">
            Set <code className="text-gray-400 bg-gray-800 px-1 rounded">GARMIN_EMAIL</code> and{' '}
            <code className="text-gray-400 bg-gray-800 px-1 rounded">GARMIN_PASSWORD</code> in{' '}
            <code className="text-gray-400 bg-gray-800 px-1 rounded">backend/.env</code> first.
          </p>
        </div>
      </div>
    )
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/routes" element={<RoutesPage />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
