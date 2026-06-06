import { NavLink } from 'react-router-dom'
import { type ReactNode, useState } from 'react'
import { LayoutDashboard, CalendarDays, Map, Settings } from 'lucide-react'
import clsx from 'clsx'
import { getModelPref, setModelPref, type ModelPref } from '../api/client'

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/plan', label: 'Plan', icon: CalendarDays },
  { to: '/routes', label: 'Routes', icon: Map },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export default function Layout({ children }: { children: ReactNode }) {
  const [model, setModel] = useState<ModelPref>(getModelPref())

  function toggleModel(pref: ModelPref) {
    setModel(pref)
    setModelPref(pref)
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F5F0EB' }}>
      <header className="sticky top-0 z-10 border-b border-gray-200" style={{ backgroundColor: '#F5F0EB' }}>
        <div className="max-w-[680px] mx-auto px-6 h-12 flex items-center justify-between">
          {/* Logo */}
          <span className="serif italic text-base font-normal" style={{ color: '#1A1A1A' }}>
            aicoach
          </span>

          {/* Nav links */}
          <nav className="flex items-center gap-6">
            {nav.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  clsx(
                    'text-xs tracking-wide transition-colors',
                    isActive
                      ? 'underline underline-offset-4'
                      : 'hover:underline hover:underline-offset-4',
                  )
                }
                style={{ color: '#1A1A1A' }}
              >
                {label}
              </NavLink>
            ))}
          </nav>

          {/* Model selector */}
          <div className="flex items-center gap-1 text-xs" style={{ color: '#8C7B6B' }}>
            {'[ '}
            {(['haiku', 'sonnet'] as ModelPref[]).map((m, i) => (
              <span key={m}>
                {i > 0 && <span className="mx-1">|</span>}
                <button
                  onClick={() => toggleModel(m)}
                  className={clsx(
                    'capitalize transition-colors',
                    model === m
                      ? 'underline underline-offset-4'
                      : 'hover:underline hover:underline-offset-4',
                  )}
                  style={{ color: model === m ? '#1A1A1A' : '#8C7B6B' }}
                >
                  {m}
                </button>
              </span>
            ))}
            {' ]'}
          </div>
        </div>
      </header>

      <main>
        <div className="max-w-[680px] mx-auto px-6 py-12">
          {children}
        </div>
      </main>
    </div>
  )
}
