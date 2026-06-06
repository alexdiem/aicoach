import { useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Activity } from 'lucide-react'
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
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 mb-10">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Activity size={16} className="text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight text-white">ai<span className="text-blue-400">coach</span></span>
          </div>

          <h1 className="text-2xl font-bold text-white mb-1">Get started</h1>
          <p className="text-zinc-400 text-sm mb-8">
            Connect your Garmin account to start building your training plan.
          </p>

          <button
            onClick={handleConnect}
            disabled={connecting}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-semibold text-sm transition-colors"
          >
            {connecting ? 'Connecting…' : 'Connect Garmin Account'}
          </button>

          {error && (
            <div className="mt-4 bg-red-950/60 border border-red-800 rounded-lg p-3 text-red-300 text-sm">
              {error}
            </div>
          )}

          <p className="text-zinc-600 text-xs mt-6 leading-relaxed">
            Set{' '}
            <code className="text-zinc-400 bg-zinc-800 px-1 py-0.5 rounded">GARMIN_EMAIL</code>{' '}
            and{' '}
            <code className="text-zinc-400 bg-zinc-800 px-1 py-0.5 rounded">GARMIN_PASSWORD</code>{' '}
            in <code className="text-zinc-400 bg-zinc-800 px-1 py-0.5 rounded">backend/.env</code> first.
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
