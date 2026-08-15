import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Logo } from '../brand/Logo'
import { Icon } from '../ui/Icon'
import { ThemeToggle } from '../ThemeToggle'
import { Avatar } from './Avatar'
import { navFor } from './nav'
import { useAuth } from '../../context/AuthContext'
import { ROLE_LABEL, fullName } from '../../lib/types'

function NavRows({ onNavigate }: { onNavigate?: () => void }) {
  const { profile } = useAuth()
  if (!profile) return null

  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
      {navFor(profile.role).map((group) => (
        <div key={group.title}>
          <p className="eyebrow px-3 pb-2 text-white/35">{group.title}</p>
          <ul className="space-y-0.5">
            {group.items.map((item) =>
              item.to ? (
                <li key={item.label}>
                  <NavLink
                    to={item.to}
                    end
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14.5px] transition-colors duration-200 ${
                        isActive
                          ? 'bg-white/12 font-semibold text-white'
                          : 'text-white/62 hover:bg-white/7 hover:text-white'
                      }`
                    }
                  >
                    <Icon name={item.icon} size={18} />
                    {item.label}
                  </NavLink>
                </li>
              ) : (
                <li key={item.label}>
                  <span
                    aria-disabled
                    title="Coming in the next release"
                    className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-[14.5px] text-white/28"
                  >
                    <Icon name={item.icon} size={18} />
                    <span className="flex-1 truncate">{item.label}</span>
                    <span className="rounded-full bg-white/8 px-2 py-0.5 font-mono text-[9.5px] tracking-wider uppercase">
                      Soon
                    </span>
                  </span>
                </li>
              ),
            )}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { profile } = useAuth()

  return (
    <>
      <div className="flex h-[70px] shrink-0 items-center px-5">
        <Link to="/" aria-label="Collabify home">
          <Logo tone="onDark" size={32} subtitle={profile ? ROLE_LABEL[profile.role] : ''} />
        </Link>
      </div>
      <NavRows onNavigate={onNavigate} />
      <div className="shrink-0 px-3 pb-4">
        <div className="rounded-2xl bg-white/6 p-3.5">
          <p className="eyebrow text-white/40">Phase 1</p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/55">
            Boards, milestones, and files land in the next release. Settings is live now.
          </p>
        </div>
      </div>
    </>
  )
}

function AccountMenu() {
  const { profile, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!profile) return null

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2.5 rounded-full py-1 pr-2 pl-1 transition-colors hover:bg-[var(--surface-sunken)]"
      >
        <Avatar profile={profile} size={34} />
        <span className="hidden text-left leading-tight sm:block">
          <span className="block max-w-[150px] truncate text-[13.5px] font-semibold text-ink">
            {fullName(profile)}
          </span>
          <span className="block text-[11.5px] text-muted">{ROLE_LABEL[profile.role]}</span>
        </span>
        <Icon name="chevronDown" size={15} className="hidden text-faint sm:block" />
      </button>

      {open && (
        <div
          role="menu"
          className="surface absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-line shadow-lift"
        >
          <div className="border-b border-line px-4 py-3.5">
            <p className="truncate text-[14px] font-semibold text-ink">{fullName(profile)}</p>
            <p className="truncate text-[12.5px] text-muted">{profile.email}</p>
          </div>
          <Link
            to="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-4 py-3 text-[14px] text-ink hover:bg-[var(--surface-sunken)]"
          >
            <Icon name="settings" size={17} className="text-muted" />
            Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            className="flex w-full items-center gap-3 border-t border-line px-4 py-3 text-left text-[14px] text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
          >
            <Icon name="logout" size={17} />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

export function AppShell() {
  const [drawer, setDrawer] = useState(false)
  const location = useLocation()

  useEffect(() => setDrawer(false), [location.pathname])
  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [drawer])

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[276px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col bg-navy-600 dark:bg-navy-800 lg:flex">
        <SidebarBody />
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-navy-950/60 backdrop-blur-sm"
            aria-label="Close navigation"
            onClick={() => setDrawer(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-[280px] flex-col bg-navy-600 shadow-2xl dark:bg-navy-800">
            <SidebarBody onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="surface sticky top-0 z-40 border-b border-line">
          <div className="flex h-[70px] items-center justify-between gap-3 px-4 md:px-7">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setDrawer(true)}
                aria-label="Open navigation"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted hover:bg-[var(--surface-sunken)] lg:hidden"
              >
                <Icon name="menu" size={20} />
              </button>
              <Link to="/" className="lg:hidden" aria-label="Collabify home">
                <Logo size={30} showSubtitle={false} />
              </Link>
            </div>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <AccountMenu />
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-7 md:px-7 md:py-9">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
