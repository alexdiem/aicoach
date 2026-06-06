import { NavLink } from 'react-router-dom'
import { type ReactNode, useState } from 'react'
import clsx from 'clsx'
import { getModelPref, setModelPref, type ModelPref } from '../api/client'

const nav = [
  { to: '/', label: 'Dashboard' },
  { to: '/plan', label: 'Plan' },
  { to: '/routes', label: 'Routes' },
  { to: '/settings', label: 'Settings' },
]

export default function Layout({ children }: { children: ReactNode }) {
  const [model, setModel] = useState<ModelPref>(getModelPref())

  function toggleModel(pref: ModelPref) {
    setModel(pref)
    setModelPref(pref)
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#1A1410' }}>
      <header
        className="sticky top-0 z-50 flex items-center px-8 h-14"
        style={{ backgroundColor: '#1A1410', borderBottom: '1px solid #332820' }}
      >
        {/* Logo */}
        <span className="text-lg font-bold tracking-tight shrink-0" style={{ color: '#F5F0E8' }}>
          ai<span style={{ color: '#F59E0B' }}>coach</span>
        </span>

        {/* Nav center */}
        <nav className="flex-1 flex items-center justify-center gap-8">
          {nav.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                clsx(
                  'text-sm font-medium transition-colors pb-0.5',
                  isActive
                    ? 'border-b-2 border-amber-500'
                    : 'hover:opacity-80',
                )
              }
              style={({ isActive: active }) => ({
                color: active ? '#F59E0B' : '#8C7B6B',
              })}
            >
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Model selector */}
        <div
          className="flex items-center rounded-full overflow-hidden text-xs font-medium shrink-0"
          style={{ border: '1px solid #332820' }}
        >
          {(['haiku', 'sonnet'] as ModelPref[]).map((m) => (
            <button
              key={m}
              onClick={() => toggleModel(m)}
              className="px-3 py-1 capitalize transition-colors"
              style={{
                backgroundColor: model === m ? '#F59E0B' : 'transparent',
                color: model === m ? '#1A1410' : '#8C7B6B',
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </header>

      <main>
        <div className="max-w-5xl mx-auto px-6 py-8">{children}</div>
      </main>
    </div>
  )
}
