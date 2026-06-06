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
    <div className="min-h-screen flex bg-zinc-950">
      <nav className="w-52 shrink-0 bg-zinc-900 border-r border-zinc-800 flex flex-col p-3">
        <div className="px-3 py-4 mb-2">
          <span className="text-lg font-bold tracking-tight text-white">ai<span className="text-blue-400">coach</span></span>
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
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800',
                )
              }
            >
              <Icon size={16} strokeWidth={1.75} />
              {label}
            </NavLink>
          ))}
        </div>

        {/* Model selector */}
        <div className="mt-auto pt-4 border-t border-zinc-800">
          <div className="px-1 mb-1.5 flex items-center gap-1.5 text-[10px] text-zinc-600 uppercase tracking-wider">
            <Bot size={10} /> AI Model
          </div>
          <div className="flex rounded-lg overflow-hidden border border-zinc-700 text-xs font-medium">
            {(['haiku', 'sonnet'] as ModelPref[]).map((m) => (
              <button
                key={m}
                onClick={() => toggleModel(m)}
                className={clsx(
                  'flex-1 py-1.5 transition-colors capitalize',
                  model === m
                    ? 'bg-zinc-700 text-white'
                    : 'text-zinc-500 hover:text-zinc-300',
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="mt-1.5 px-1 text-[10px] text-zinc-600 leading-snug">
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
