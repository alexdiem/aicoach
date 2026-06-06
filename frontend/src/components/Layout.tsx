import { NavLink } from 'react-router-dom'
import { type ReactNode, useState } from 'react'
import clsx from 'clsx'
import { getModelPref, setModelPref, type ModelPref } from '../api/client'

const nav = [
  { to: '/', label: 'DASHBOARD' },
  { to: '/plan', label: 'PLAN' },
  { to: '/routes', label: 'ROUTES' },
  { to: '/settings', label: 'SETTINGS' },
]

export default function Layout({ children }: { children: ReactNode }) {
  const [model, setModel] = useState<ModelPref>(getModelPref())

  function toggleModel(pref: ModelPref) {
    setModel(pref)
    setModelPref(pref)
  }

  return (
    <div className="min-h-screen flex bg-black font-mono">
      <nav className="w-48 shrink-0 bg-black border-r border-lime-400/30 flex flex-col p-0">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-lime-400/30">
          <span className="text-lg font-bold tracking-tight text-lime-400 font-mono">[AICOACH]</span>
        </div>

        {/* Nav items */}
        <div className="flex flex-col mt-2">
          {nav.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                clsx(
                  'block px-4 py-2.5 text-xs font-mono font-medium tracking-widest transition-all border-b border-lime-400/10',
                  isActive
                    ? 'bg-lime-400 text-black'
                    : 'text-lime-400/60 hover:bg-lime-400 hover:text-black',
                )
              }
            >
              &gt; {label}
            </NavLink>
          ))}
        </div>

        {/* Model selector */}
        <div className="mt-auto border-t border-lime-400/30 p-4">
          <p className="text-[10px] text-lime-400/40 uppercase tracking-widest mb-2">AI MODEL</p>
          <div className="flex border border-lime-400/30 overflow-hidden">
            {(['haiku', 'sonnet'] as ModelPref[]).map((m) => (
              <button
                key={m}
                onClick={() => toggleModel(m)}
                className={clsx(
                  'flex-1 py-1.5 text-[10px] font-mono uppercase tracking-widest transition-colors',
                  model === m
                    ? 'bg-lime-400 text-black'
                    : 'text-lime-400/50 hover:bg-lime-400 hover:text-black',
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[9px] text-lime-400/30 leading-snug font-mono">
            {model === 'haiku' ? 'FAST · LOWER COST' : 'SMARTER · HIGHER COST'}
          </p>
        </div>
      </nav>

      <main className="flex-1 overflow-auto bg-black">
        <div className="max-w-6xl mx-auto px-6 py-8">{children}</div>
      </main>
    </div>
  )
}
