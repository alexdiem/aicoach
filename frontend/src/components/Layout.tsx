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
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#0D1117' }}>
      {/* Left panel — 320px fixed, contains page content + bottom nav */}
      <div
        className="w-80 shrink-0 flex flex-col h-full border-r"
        style={{ borderColor: '#30363D', backgroundColor: '#0D1117' }}
      >
        {/* Logo bar */}
        <div className="px-4 py-3 shrink-0 flex items-center justify-between border-b" style={{ borderColor: '#30363D' }}>
          <span className="text-base font-bold tracking-tight" style={{ color: '#E6EDF3' }}>
            ai<span style={{ color: '#58A6FF' }}>coach</span>
          </span>
          {/* Model toggle — compact pill */}
          <div
            className="flex rounded-md overflow-hidden border text-[10px] font-medium"
            style={{ borderColor: '#30363D' }}
          >
            {(['haiku', 'sonnet'] as ModelPref[]).map((m) => (
              <button
                key={m}
                onClick={() => toggleModel(m)}
                className="px-2 py-1 capitalize transition-colors"
                style={
                  model === m
                    ? { backgroundColor: '#30363D', color: '#E6EDF3' }
                    : { backgroundColor: 'transparent', color: '#484F58' }
                }
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable page content area */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {children}
        </div>

        {/* Bottom tab bar */}
        <div
          className="shrink-0 flex border-t"
          style={{ borderColor: '#30363D', backgroundColor: '#0D1117' }}
        >
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors',
                  isActive
                    ? 'text-[#58A6FF]'
                    : 'text-[#484F58] hover:text-[#8B949E]',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={18} strokeWidth={isActive ? 2 : 1.5} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </div>

      {/* Right panel — detail view */}
      <div className="flex-1 flex items-center justify-center select-none text-sm" style={{ color: '#30363D' }}>
        Select an item to view details
      </div>
    </div>
  )
}
