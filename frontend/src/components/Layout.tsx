import { NavLink } from 'react-router-dom'
import { type ReactNode } from 'react'
import clsx from 'clsx'

const nav = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/plan', label: 'Plan', icon: '📅' },
  { to: '/routes', label: 'Routes', icon: '🗺️' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
]

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex">
      <nav className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col p-4 gap-1">
        <div className="mb-6 px-2">
          <span className="text-xl font-bold text-white">aicoach</span>
        </div>
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800',
              )
            }
          >
            <span>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  )
}
