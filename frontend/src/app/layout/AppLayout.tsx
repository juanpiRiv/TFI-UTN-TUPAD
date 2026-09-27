import { useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import { cn } from '@/lib/cn'

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/movimientos', label: 'Movimientos' },
  { to: '/clientes', label: 'Clientes' },
  { to: '/categorias', label: 'Categorías' },
  { to: '/organizacion', label: 'Mi negocio' },
]

type AppLayoutProps = {
  organizationName?: string
  userEmail?: string
  onLogout?: () => void
}

export function AppLayout({ organizationName, userEmail, onLogout }: AppLayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="min-h-dvh md:flex">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <span className="font-semibold text-brand-700">Gestión financiera</span>
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls="main-nav"
          className="rounded-md border border-slate-300 px-3 py-1 text-sm"
        >
          Menú
        </button>
      </header>

      <aside
        id="main-nav"
        className={cn(
          'border-b border-slate-200 bg-white md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:shrink-0 md:flex-col md:border-r md:border-b-0',
          menuOpen ? 'block' : 'hidden md:flex',
        )}
      >
        <div className="hidden px-5 py-5 md:block">
          <p className="font-semibold text-brand-700">Gestión financiera</p>
          {organizationName && (
            <p className="mt-1 truncate text-sm text-slate-500">{organizationName}</p>
          )}
        </div>
        <nav aria-label="Principal" className="flex flex-col gap-1 px-3 py-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                cn(
                  'rounded-lg px-3 py-2 text-sm font-medium',
                  isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-700 hover:bg-slate-100',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto border-t border-slate-200 px-5 py-4 text-sm">
          {userEmail && <p className="truncate text-slate-500">{userEmail}</p>}
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="mt-2 font-medium text-slate-700 underline hover:text-slate-900"
            >
              Cerrar sesión
            </button>
          )}
        </div>
      </aside>

      <main className="mx-auto w-full max-w-6xl min-w-0 px-4 py-6 md:px-8">
        <Outlet />
      </main>
    </div>
  )
}
