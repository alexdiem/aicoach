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
    <div className="min-h-screen flex" style={{ backgroundColor: '#080810' }}>
      {/* Aurora background orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
        {/* Blue-violet orb — top left */}
        <div
          className="absolute"
          style={{
            top: '-20%',
            left: '-10%',
            width: '60vw',
            height: '60vw',
            background: 'radial-gradient(circle, rgba(99,56,210,0.35) 0%, rgba(59,130,246,0.18) 45%, transparent 70%)',
            filter: 'blur(120px)',
            opacity: 0.8,
          }}
        />
        {/* Emerald-cyan orb — bottom right */}
        <div
          className="absolute"
          style={{
            bottom: '-20%',
            right: '-10%',
            width: '55vw',
            height: '55vw',
            background: 'radial-gradient(circle, rgba(16,185,129,0.28) 0%, rgba(6,182,212,0.15) 45%, transparent 70%)',
            filter: 'blur(120px)',
            opacity: 0.7,
          }}
        />
      </div>

      {/* Glassmorphism sidebar */}
      <nav
        className="w-52 shrink-0 flex flex-col p-3 border-r relative"
        style={{
          zIndex: 10,
          backgroundColor: 'rgba(255,255,255,0.04)',
          backdropFilter: 'blur(24px)',
          borderColor: 'rgba(255,255,255,0.08)',
        }}
      >
        <div className="px-3 py-4 mb-2">
          <span className="text-lg font-bold tracking-tight text-white">
            ai<span style={{ color: '#3B82F6' }}>coach</span>
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
                    ? 'text-white'
                    : 'text-white/40 hover:text-white/80 hover:bg-white/5',
                )
              }
              style={({ isActive }) =>
                isActive
                  ? {
                      background: 'rgba(59,130,246,0.25)',
                      boxShadow: '0 0 16px rgba(59,130,246,0.35), inset 0 0 0 1px rgba(59,130,246,0.4)',
                    }
                  : {}
              }
            >
              <Icon size={16} strokeWidth={1.75} />
              {label}
            </NavLink>
          ))}
        </div>

        {/* Model selector */}
        <div className="mt-auto pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="px-1 mb-1.5 flex items-center gap-1.5 text-[10px] text-white/30 uppercase tracking-wider">
            <Bot size={10} /> AI Model
          </div>
          <div
            className="flex rounded-lg overflow-hidden text-xs font-medium"
            style={{ border: '1px solid rgba(255,255,255,0.1)' }}
          >
            {(['haiku', 'sonnet'] as ModelPref[]).map((m) => (
              <button
                key={m}
                onClick={() => toggleModel(m)}
                className={clsx(
                  'flex-1 py-1.5 transition-all capitalize',
                  model === m
                    ? 'text-white'
                    : 'text-white/30 hover:text-white/60',
                )}
                style={
                  model === m
                    ? { background: 'rgba(59,130,246,0.3)', boxShadow: 'inset 0 0 0 1px rgba(59,130,246,0.4)' }
                    : {}
                }
              >
                {m}
              </button>
            ))}
          </div>
          <p className="mt-1.5 px-1 text-[10px] text-white/25 leading-snug">
            {model === 'haiku' ? 'Fast · lower cost' : 'Smarter · higher cost'}
          </p>
        </div>
      </nav>

      <main className="flex-1 overflow-auto relative" style={{ zIndex: 10 }}>
        <div className="max-w-6xl mx-auto px-6 py-8">{children}</div>
      </main>
    </div>
  )
}
