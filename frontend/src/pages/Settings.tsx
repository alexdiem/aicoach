import { useEffect, useState } from 'react'
import { getAthleteId, getAthlete, updateAthlete, syncActivities } from '../api/client'
import type { Athlete } from '../types'

export default function Settings() {
  const athleteId = getAthleteId()!
  const [athlete, setAthlete] = useState<Athlete | null>(null)
  const [ftp, setFtp] = useState('')
  const [lthr, setLthr] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getAthlete(athleteId).then((a) => {
      setAthlete(a)
      setFtp(String(a.ftp_watts ?? ''))
      setLthr(String(a.lthr ?? ''))
      setName(a.display_name ?? '')
    })
  }, [athleteId])

  async function handleSave() {
    setSaving(true)
    await updateAthlete(athleteId, {
      display_name: name || undefined,
      ftp_watts: ftp ? parseFloat(ftp) : undefined,
      lthr: lthr ? parseFloat(lthr) : undefined,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    setSaving(false)
  }

  async function handleSync() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const r = await syncActivities(athleteId, 60)
      setSyncResult(`Synced ${r.synced} new activities.`)
    } catch {
      setSyncResult('Sync failed. Check Garmin connection.')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-8">
      <h1 className="text-2xl font-bold text-white">Settings</h1>

      {/* Garmin connection */}
      <section className="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <h2 className="text-base font-semibold text-white mb-4">Garmin Connection</h2>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-green-400 text-lg">●</span>
          <span className="text-gray-300 text-sm">Connected (athlete ID: {athleteId})</span>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {syncing ? 'Syncing…' : 'Sync last 60 days'}
          </button>
          <a
            href="/api/auth/login"
            className="text-blue-400 hover:text-blue-300 text-sm px-4 py-2 border border-gray-700 rounded-lg"
          >
            Reconnect
          </a>
        </div>
        {syncResult && <p className="text-sm text-gray-400 mt-3">{syncResult}</p>}
      </section>

      {/* Athlete profile */}
      <section className="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <h2 className="text-base font-semibold text-white mb-4">Athlete Profile</h2>
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-xs text-gray-500 font-medium uppercase mb-1.5 block">Display Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm w-full"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-medium uppercase mb-1.5 block">
              FTP (watts) — used for TSS and interval targeting
            </label>
            <input
              value={ftp}
              onChange={(e) => setFtp(e.target.value)}
              type="number"
              placeholder="e.g. 260"
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm w-40"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-medium uppercase mb-1.5 block">
              LTHR (bpm) — lactate threshold heart rate for HR-based TSS
            </label>
            <input
              value={lthr}
              onChange={(e) => setLthr(e.target.value)}
              type="number"
              placeholder="e.g. 162"
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm w-40"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-semibold w-fit transition-colors"
          >
            {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </section>

      {/* Garmin API setup guide */}
      <section className="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <h2 className="text-base font-semibold text-white mb-4">Getting Garmin API Credentials</h2>
        <ol className="flex flex-col gap-3 text-sm text-gray-400">
          <li>
            <span className="text-white font-medium">1. Apply for Garmin Health API access</span>
            <br />
            Visit <span className="text-blue-400">developer.garmin.com/health-api</span> and create a developer account.
            Request a Consumer Key and Consumer Secret (OAuth 1.0a).
          </li>
          <li>
            <span className="text-white font-medium">2. Create a .env file</span>
            <br />
            Copy <code className="text-gray-300 bg-gray-800 px-1 rounded">backend/.env.example</code> to{' '}
            <code className="text-gray-300 bg-gray-800 px-1 rounded">backend/.env</code> and fill in your credentials.
          </li>
          <li>
            <span className="text-white font-medium">3. Set your OAuth callback URL</span>
            <br />
            In the Garmin developer console, add{' '}
            <code className="text-gray-300 bg-gray-800 px-1 rounded">http://localhost:8000/auth/callback</code> as an
            authorized callback URL.
          </li>
          <li>
            <span className="text-white font-medium">4. Register your webhook URL (optional)</span>
            <br />
            For real-time activity push, register{' '}
            <code className="text-gray-300 bg-gray-800 px-1 rounded">https://your-domain/garmin/webhook</code>{' '}
            in the Garmin developer console. For local use, manually sync via the button above.
          </li>
          <li>
            <span className="text-white font-medium">5. Add your Anthropic API key (optional)</span>
            <br />
            Set <code className="text-gray-300 bg-gray-800 px-1 rounded">ANTHROPIC_API_KEY</code> in your .env for
            AI coaching narratives and compliance scoring. Without it, the app works fully with rule-based logic.
          </li>
        </ol>
      </section>
    </div>
  )
}
