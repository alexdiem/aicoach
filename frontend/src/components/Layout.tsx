import { NavLink } from 'react-router-dom'
import { type ReactNode, useState } from 'react'
import { LayoutDashboard, CalendarDays, Map, Settings, Bot } from 'lucide-react'
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
    <div className="min-h-screen flex" style={{ backgroundColor: '#0A0A12' }}>
      <nav
        className="w-52 shrink-0 flex flex-col p-3"
        style={{ backgroundColor: '#0A0A12', borderRight: '1px solid #1E1E35' }}
      >
        <div className="px-3 py-4 mb-2">
          <span className="text-lg font-bold tracking-tight text-white">
            ai<span style={{ color: '#A78BFA' }}>coach</span>
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all',
                  isActive
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'hover:text-white',
                )
              }
              style={({ isActive }) =>
                isActive ? {} : { color: '#6B6B8A' }
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={16} strokeWidth={1.75} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>

        {/* Model selector */}
        <div className="mt-auto pt-4" style={{ borderTop: '1px solid #1E1E35' }}>
          <div className="px-1 mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider" style={{ color: '#6B6B8A' }}>
            <Bot size={10} /> AI Model
          </div>
          <div
            className="flex rounded-lg overflow-hidden text-xs font-medium"
            style={{ border: '1px solid #1E1E35' }}
          >
            {(['haiku', 'sonnet'] as ModelPref[]).map((m) => (
              <button
                key={m}
                onClick={() => toggleModel(m)}
                className={clsx(
                  'flex-1 py-1.5 transition-colors capitalize',
                  model === m
                    ? 'bg-violet-600 text-white'
                    : 'hover:text-white',
                )}
                style={model === m ? {} : { color: '#6B6B8A' }}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="mt-1.5 px-1 text-[10px] leading-snug" style={{ color: '#6B6B8A' }}>
            {model === 'haiku' ? 'Fast · lower cost' : 'Smarter · higher cost'}
          </p>
        </div>
      </nav>
      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto px-6 py-8">{children}</div>
      </main>
    </div>
  )
}
