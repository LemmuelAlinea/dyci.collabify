import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { ROLE_LABEL, fullName } from '../../lib/types'
import { homeFor, workplaceOf } from '../../lib/workplace'
import { Logo } from '../brand/Logo'
import { ThemeToggle } from '../ThemeToggle'
import { Icon } from '../ui/Icon'
import { Avatar } from './Avatar'
import { NotificationBell } from './NotificationBell'

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && close()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [close, open])
  return ref
}

function AccountMenu() {
  const { profile, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))

  if (!profile) return null

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full py-1 pr-1.5 pl-1 text-amber-50 transition-colors hover:bg-white/8"
      >
        <Avatar profile={profile} size={30} />
        <span className="hidden max-w-[130px] truncate text-[13px] font-medium text-amber-50/85 lg:block">
          {profile.first_name}
        </span>
        <Icon name="chevronDown" size={15} className="hidden text-amber-50/42 lg:block" />
      </button>

      {open && (
        <div
          role="menu"
          className="surface absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border border-line shadow-lift"
        >
          <div className="border-b border-line px-4 py-3.5">
            <p className="truncate text-[14px] font-semibold text-ink">{fullName(profile)}</p>
            <p className="truncate text-[12px] text-muted">{profile.email}</p>
            <p className="mt-1 text-[12px] text-faint">
              {profile.role ? ROLE_LABEL[profile.role] : 'General workplace'}
            </p>
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
            className="flex w-full items-center gap-3 border-t border-line px-4 py-3 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
          >
            <Icon name="logout" size={17} />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

export function TopNav({ onOpenDrawer }: { onOpenDrawer: () => void }) {
  const { profile } = useAuth()
  const location = useLocation()
  const bar = useRef<HTMLElement>(null)

  useEffect(() => {
    const element = bar.current
    if (!element) return
    const write = () =>
      document.documentElement.style.setProperty('--app-bar', `${Math.round(element.offsetHeight)}px`)
    write()
    const observer = new ResizeObserver(write)
    observer.observe(element)
    return () => {
      observer.disconnect()
      document.documentElement.style.removeProperty('--app-bar')
    }
  }, [])

  if (!profile) return null

  const workplace = workplaceOf(location.pathname, profile.home_workplace)

  return (
    <header
      ref={bar}
      className="blueprint sticky top-0 z-40 border-b border-white/10 bg-navy-950 text-amber-50"
    >
      <div className="flex h-[58px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8 xl:px-10 2xl:px-12">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenDrawer}
            aria-label="Open navigation"
            className="-ml-2 grid h-10 w-10 shrink-0 place-items-center rounded-lg text-amber-50/65 hover:bg-white/8 hover:text-amber-50 lg:hidden"
          >
            <Icon name="menu" size={20} />
          </button>
          <Link
            to={workplace === 'general' ? '/general' : homeFor(profile)}
            aria-label="Go to your dashboard"
          >
            <Logo size={28} tone="onDark" showSubtitle={false} />
          </Link>
        </div>

        <div className="flex items-center gap-0.5 sm:gap-1">
          <NotificationBell tone="onNavy" />
          <ThemeToggle tone="onNavy" />
          <AccountMenu />
        </div>
      </div>
    </header>
  )
}
