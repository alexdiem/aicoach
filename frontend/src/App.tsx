import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Plan from './pages/Plan'
import RoutesPage from './pages/Routes'
import Settings from './pages/Settings'
import { setAthleteId, getAthleteId } from './api/client'

export default function App() {
  // Handle OAuth callback: ?connected=true&athlete_id=1
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('connected') === 'true') {
      const id = params.get('athlete_id')
      if (id) {
        setAthleteId(parseInt(id))
        window.history.replaceState({}, '', '/')
      }
    }
  }, [])

  const athleteId = getAthleteId()

  if (!athleteId) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-6">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-white mb-2">aicoach</h1>
          <p className="text-gray-400 mb-8">Your cross-sport training planner</p>
          <a
            href="/api/auth/login"
            className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-lg font-semibold transition-colors"
          >
            Connect Garmin Account
          </a>
        </div>
        <p className="text-gray-600 text-sm">
          You'll need a Garmin Health API developer account.{' '}
          <a href="/settings" className="text-blue-400 hover:underline">Setup guide</a>
        </p>
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
