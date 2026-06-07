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
    <div className="min-h-screen flex bg-white">
      <nav className="w-52 shrink-0 bg-white border-r border-gray-200 hidden md:flex flex-col p-3">
        <div className="px-3 py-4 mb-2">
          <span className="text-lg font-bold tracking-tight text-gray-950">ai<span className="text-indigo-600">coach</span></span>
        </div>
        <div className="flex flex-col gap-0.5">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }: { isActive: boolean }) =>
                clsx(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all',
                  isActive
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50',
                )
              }
            >
              <Icon size={16} strokeWidth={1.75} />
              {label}
            </NavLink>
          ))}
        </div>

        {/* Model selector */}
        <div className="mt-auto pt-4 border-t border-gray-200">
          <div className="px-1 mb-1.5 flex items-center gap-1.5 text-[10px] text-gray-400 uppercase tracking-wider">
            <Bot size={10} /> AI Model
          </div>
          <div className="flex rounded-lg overflow-hidden border border-gray-200 text-xs font-medium">
            {(['haiku', 'sonnet'] as ModelPref[]).map((m) => (
              <button
                key={m}
                onClick={() => toggleModel(m)}
                aria-pressed={model === m}
                className={clsx(
                  'flex-1 py-1.5 transition-colors capitalize',
                  model === m
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-500 hover:text-gray-700 bg-white',
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="mt-1.5 px-1 text-[10px] text-gray-400 leading-snug">
            {model === 'haiku' ? 'Fast · lower cost' : 'Smarter · higher cost'}
          </p>
        </div>
      </nav>
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center justify-between border-b border-gray-200 px-4 py-3 bg-white">
          <span className="text-lg font-bold tracking-tight text-gray-950">ai<span className="text-indigo-600">coach</span></span>
          <nav className="flex items-center gap-1">
            {nav.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                aria-label={label}
                className={({ isActive }: { isActive: boolean }) =>
                  clsx(
                    'p-2 rounded-lg transition-colors',
                    isActive
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50',
                  )
                }
              >
                <Icon size={18} strokeWidth={1.75} />
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="flex-1 overflow-auto bg-white">
          <div className="max-w-6xl mx-auto px-6 py-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
