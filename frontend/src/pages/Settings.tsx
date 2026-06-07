import { useEffect, useState } from 'react'
import { CheckCircle2, RefreshCw } from 'lucide-react'
import { getAthleteId, getAthlete, updateAthlete, syncActivities } from '../api/client'
import type { Athlete } from '../types'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl p-6 border border-gray-200">
      <h2 className="text-sm font-semibold text-gray-900 mb-5">{title}</h2>
      {children}
    </section>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</label>
      {hint && <p className="text-xs text-gray-400 leading-relaxed">{hint}</p>}
      {children}
    </div>
  )
}

export default function Settings() {
  const athleteId = getAthleteId()!
  const [athlete, setAthlete] = useState<Athlete | null>(null)
  const [ftp, setFtp] = useState('')
  const [lthr, setLthr] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [syncingDays, setSyncingDays] = useState<number | null>(null)
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
    setSyncingDays(days)
    setSyncResult(null)
    try {
      const r = await syncActivities(athleteId, days)
      setSyncResult(`Synced ${r.synced} new activities.`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      setSyncResult(`Sync failed: ${msg}`)
    } finally {
      setSyncingDays(null)
    }
  }

  return (
    <div className="max-w-2xl flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
      </div>

      <Section title="Garmin Connection">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="text-sm text-gray-600">
            Connected as <span className="font-semibold text-gray-900">{athlete?.display_name ?? '…'}</span>
          </span>
        </div>
        <div className="flex gap-2 flex-wrap">
          {([{ days: 30, label: 'Sync last 30 days' }, { days: 180, label: 'Sync last 6 months' }] as const).map(({ days, label }) => {
            const active = syncingDays === days
            return (
              <button
                key={days}
                onClick={() => handleSync(days)}
                disabled={syncingDays !== null}
                className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors border border-gray-200"
              >
                <RefreshCw size={13} className={active ? 'animate-spin' : ''} />
                {active ? 'Syncing…' : label}
              </button>
            )
          })}
        </div>
        {syncResult && (
          <p className="text-sm text-gray-500 mt-3 flex items-center gap-2">
            <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
            {syncResult}
          </p>
        )}
        <p className="text-xs text-gray-400 mt-4 leading-relaxed">
          Uses credentials from{' '}
          <code className="text-gray-600 bg-gray-100 px-1 py-0.5 rounded">backend/.env</code>. No developer account needed.
        </p>
      </Section>

      <Section title="Athlete Profile">
        <div className="flex flex-col gap-5">
          <Field label="Display Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-900 text-sm w-full focus:outline-none focus:ring-1 focus:ring-blue-500 transition-shadow"
            />
          </Field>
          <Field
            label="FTP (watts)"
            hint="Used for cycling TSS and interval targeting. Do a 20min all-out test and multiply by 0.95."
          >
            <input
              value={ftp}
              onChange={(e) => setFtp(e.target.value)}
              type="number"
              placeholder="e.g. 260"
              className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-900 text-sm w-36 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-shadow"
            />
          </Field>
          <Field
            label="LTHR (bpm)"
            hint="Lactate threshold heart rate — used for HR-based TSS on runs and ski sessions. Average HR from a 30-min maximal effort."
          >
            <input
              value={lthr}
              onChange={(e) => setLthr(e.target.value)}
              type="number"
              placeholder="e.g. 162"
              className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-900 text-sm w-36 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-shadow"
            />
          </Field>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold w-fit transition-colors"
          >
            {saved ? (
              <><CheckCircle2 size={13} /> Saved</>
            ) : saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </Section>

      <Section title="Setup Guide">
        <ol className="flex flex-col gap-5">
          {[
            {
              title: '1. Configure credentials',
              body: (
                <>
                  Copy{' '}
                  <code className="text-gray-700 bg-gray-100 px-1 py-0.5 rounded">backend/.env.example</code> to{' '}
                  <code className="text-gray-700 bg-gray-100 px-1 py-0.5 rounded">backend/.env</code> and set your Garmin Connect email and password.
                </>
              ),
            },
            {
              title: '2. Start the backend',
              body: (
                <pre className="text-gray-700 bg-gray-100 border border-gray-200 px-3 py-2.5 rounded-lg mt-1.5 text-xs leading-relaxed">
                  {'cd backend\npip install -r requirements.txt\nuvicorn app.main:app --reload'}
                </pre>
              ),
            },
            {
              title: '3. Sync your history',
              body: 'Use the sync buttons above. First sync: do 6 months to build a proper CTL curve.',
            },
            {
              title: '4. Set FTP and LTHR',
              body: 'Critical for accurate TSS and interval targeting. Update whenever your fitness changes significantly.',
            },
            {
              title: '5. Upload GPX routes',
              body: 'Go to the Routes page and upload your regular cycling routes. The app analyses climb segments and matches them to planned intervals.',
            },
            {
              title: '6. (Optional) Anthropic API key',
              body: (
                <>
                  Set{' '}
                  <code className="text-gray-700 bg-gray-100 px-1 py-0.5 rounded">ANTHROPIC_API_KEY</code> in your .env for AI coaching narratives and compliance scoring. The app works fully without it.
                </>
              ),
            },
          ].map((step) => (
            <li key={step.title}>
              <p className="text-sm font-semibold text-gray-800 mb-1">{step.title}</p>
              <p className="text-sm text-gray-500 leading-relaxed">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  )
}
