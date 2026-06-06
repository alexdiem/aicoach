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
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#0A0A0F' }}>
      <header className="h-12 flex items-center px-6 border-b border-zinc-800 sticky top-0 z-10" style={{ backgroundColor: '#0A0A0F' }}>
        {/* Logo */}
        <span className="text-base font-bold tracking-tight text-white shrink-0">
          ai<span style={{ color: '#F59E0B' }}>coach</span>
        </span>

        {/* Nav — centered */}
        <nav className="flex-1 flex items-center justify-center gap-1">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                  isActive
                    ? 'text-white bg-zinc-800'
                    : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50',
                )
              }
            >
              <Icon size={13} strokeWidth={1.75} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Model selector — right */}
        <div className="flex items-center gap-2 shrink-0">
          <Bot size={11} className="text-zinc-600" />
          <div className="flex rounded overflow-hidden border border-zinc-700 text-[11px] font-medium">
            {(['haiku', 'sonnet'] as ModelPref[]).map((m) => (
              <button
                key={m}
                onClick={() => toggleModel(m)}
                className={clsx(
                  'px-2.5 py-1 transition-colors capitalize',
                  model === m
                    ? 'bg-zinc-700 text-white'
                    : 'text-zinc-500 hover:text-zinc-300',
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">{children}</div>
      </main>
    </div>
  )
}
