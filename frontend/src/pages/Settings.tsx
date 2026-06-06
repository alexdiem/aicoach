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

  async function handleSync(days: number) {
    setSyncing(true)
    setSyncResult(null)
    try {
      const r = await syncActivities(athleteId, days)
      setSyncResult(`Synced ${r.synced} new activities.`)
    } catch {
      setSyncResult('Sync failed. Check that GARMIN_EMAIL and GARMIN_PASSWORD are correct in backend/.env')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-8">
      <h1 className="text-2xl font-bold text-white">Settings</h1>

      {/* Garmin connection */}
      <section className="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <h2 className="text-base font-semibold text-white mb-1">Garmin Connection</h2>
        <p className="text-xs text-gray-500 mb-4">
          Uses your Garmin Connect credentials from <code className="text-gray-400 bg-gray-800 px-1 rounded">backend/.env</code>. No developer account needed.
        </p>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-green-400 text-lg">●</span>
          <span className="text-gray-300 text-sm">
            Connected as <span className="text-white font-medium">{athlete?.display_name ?? '…'}</span>
          </span>
        </div>
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={() => handleSync(30)}
            disabled={syncing}
            className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {syncing ? 'Syncing…' : 'Sync last 30 days'}
          </button>
          <button
            onClick={() => handleSync(180)}
            disabled={syncing}
            className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {syncing ? 'Syncing…' : 'Sync last 6 months'}
          </button>
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
              FTP (watts)
            </label>
            <p className="text-xs text-gray-600 mb-1.5">Used for cycling TSS and interval targeting. Do a 20min all-out test and multiply by 0.95.</p>
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
              LTHR (bpm)
            </label>
            <p className="text-xs text-gray-600 mb-1.5">Lactate threshold heart rate — used for HR-based TSS on runs and ski sessions. 30-min test average HR is a good estimate.</p>
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

      {/* Setup guide */}
      <section className="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <h2 className="text-base font-semibold text-white mb-4">Setup Guide</h2>
        <ol className="flex flex-col gap-4 text-sm text-gray-400">
          <li>
            <span className="text-white font-medium">1. Configure credentials</span>
            <br />
            Copy <code className="text-gray-300 bg-gray-800 px-1 rounded">backend/.env.example</code> to{' '}
            <code className="text-gray-300 bg-gray-800 px-1 rounded">backend/.env</code>. Set your Garmin Connect
            email and password. This is the same login you use on the Garmin Connect app or website.
          </li>
          <li>
            <span className="text-white font-medium">2. Start the backend</span>
            <pre className="text-gray-300 bg-gray-800 px-3 py-2 rounded mt-1 text-xs">
              cd backend{'\n'}
              pip install -r requirements.txt{'\n'}
              uvicorn app.main:app --reload
            </pre>
          </li>
          <li>
            <span className="text-white font-medium">3. Sync your history</span>
            <br />
            Use the sync buttons above. First sync: do 6 months to build a proper CTL curve.
          </li>
          <li>
            <span className="text-white font-medium">4. Set FTP and LTHR</span>
            <br />
            These are critical for accurate TSS and interval targeting. Update them whenever your fitness changes significantly.
          </li>
          <li>
            <span className="text-white font-medium">5. Upload GPX routes</span>
            <br />
            Go to the Routes page and upload your regular cycling routes. The app will analyze climb segments and
            match them to your planned intervals.
          </li>
          <li>
            <span className="text-white font-medium">6. (Optional) Add Anthropic API key</span>
            <br />
            Set <code className="text-gray-300 bg-gray-800 px-1 rounded">ANTHROPIC_API_KEY</code> in your .env for
            AI coaching narratives and outdoor compliance scoring. The app works fully without it.
          </li>
        </ol>
      </section>
    </div>
  )
}
