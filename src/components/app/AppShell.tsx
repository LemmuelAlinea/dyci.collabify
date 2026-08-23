import { Suspense, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Logo, LogoMark } from '../brand/Logo'
import { Icon } from '../ui/Icon'
import { PageLoading } from '../ui/PageLoading'
import { ThemeToggle } from '../ThemeToggle'
import { Avatar } from './Avatar'
import { ErrorBoundary } from './ErrorBoundary'
import { NotificationBell } from './NotificationBell'
import { navFor } from './nav'
import { useAuth } from '../../context/AuthContext'
import { useUnreadTotal } from '../../hooks/useConversations'
import { roleHome } from '../../lib/roleHome'
import { ROLE_LABEL, fullName } from '../../lib/types'

const SHUT_KEY = 'collabify.nav.shut'

/** Which groups the person folded away, remembered between visits. */
function useShutGroups() {
  const [shut, setShut] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const raw = JSON.parse(localStorage.getItem(SHUT_KEY) ?? '[]')
      return Array.isArray(raw) ? (raw as string[]) : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    localStorage.setItem(SHUT_KEY, JSON.stringify(shut))
  }, [shut])

  return {
    isShut: (title: string) => shut.includes(title),
    toggle: (title: string) =>
      setShut((v) => (v.includes(title) ? v.filter((t) => t !== title) : [...v, title])),
  }
}

function NavRows({
  onNavigate,
  collapsed,
}: {
  onNavigate?: () => void
  collapsed?: boolean
}) {
  const { profile } = useAuth()
  const unreadMessages = useUnreadTotal(profile?.id)
  const { isShut, toggle } = useShutGroups()
  const reduce = useReducedMotion()

  /**
   * Labels fade in behind the widening rail rather than appearing at full
   * strength the instant the state flips. On the way back they simply go: the
   * rail is closing over them, so fading them out as well reads as hesitation.
   */
  const label = reduce
    ? {}
    : {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { duration: 0.26, delay: 0.12, ease: [0.22, 1, 0.36, 1] as const },
      }

  if (!profile) return null

  return (
    <nav className={`flex-1 space-y-6 overflow-y-auto py-5 ${collapsed ? 'px-2' : 'px-3'}`}>
      {navFor(profile.role).map((group) => {
        // On the icon rail there is no heading to press, so nothing folds there.
        const shut = !collapsed && isShut(group.title)
        return (
          <div key={group.title}>
            {/* Collapsed keeps a rule where the heading was, so the grouping survives. */}
            {collapsed ? (
              <div className="mx-2 mb-2 border-t border-white/10" />
            ) : (
              <motion.button
                {...label}
                type="button"
                onClick={() => toggle(group.title)}
                aria-expanded={!shut}
                className={`eyebrow flex w-full items-center gap-1.5 rounded-lg px-3 pb-2 pt-1 text-left transition-colors ${
                  // Folded away, the heading is the only thing standing for its
                  // rows, so it brightens to the accent rather than fading out.
                  shut ? 'text-amber-400 hover:text-amber-300' : 'text-white/35 hover:text-white/60'
                }`}
              >
                <Icon
                  name="chevronDown"
                  size={13}
                  className={`shrink-0 transition-transform duration-200 ${shut ? '-rotate-90' : ''}`}
                />
                <span className="flex-1 truncate">{group.title}</span>
              </motion.button>
            )}
            <ul className={`space-y-0.5 ${shut ? 'hidden' : ''}`}>
              {group.items.map((item) =>
                item.to ? (
                  <li key={item.label}>
                    <NavLink
                      to={item.to}
                      // Role homes ("/professor") must match exactly, section roots
                      // ("/professor/classes") should stay lit on their detail pages.
                      end={item.to.split('/').filter(Boolean).length < 2}
                      onClick={onNavigate}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        `relative flex items-center rounded-xl py-2.5 text-[14.5px] transition-colors duration-200 ${
                          collapsed ? 'justify-center px-0' : 'gap-3 px-3'
                        } ${
                          isActive
                            ? 'bg-white/12 font-semibold text-white'
                            : 'text-white/62 hover:bg-white/7 hover:text-white'
                        }`
                      }
                    >
                      <Icon name={item.icon} size={18} />
                      {!collapsed && (
                        <motion.span {...label} className="flex-1 truncate">
                          {item.label}
                        </motion.span>
                      )}
                      {item.badge === 'messages' &&
                        unreadMessages > 0 &&
                        (collapsed ? (
                          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-amber-400" />
                        ) : (
                          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-amber-400 px-1.5 font-mono text-[10px] font-bold text-navy-900">
                            {unreadMessages > 99 ? '99+' : unreadMessages}
                          </span>
                        ))}
                    </NavLink>
                  </li>
                ) : (
                  <li key={item.label}>
                    <span
                      aria-disabled
                      title={collapsed ? `${item.label} — coming soon` : 'Coming in the next release'}
                      className={`flex cursor-not-allowed items-center rounded-xl py-2.5 text-[14.5px] text-white/28 ${
                        collapsed ? 'justify-center px-0' : 'gap-3 px-3'
                      }`}
                    >
                      <Icon name={item.icon} size={18} />
                      {!collapsed && (
                        <motion.span
                          {...label}
                          className="flex min-w-0 flex-1 items-center gap-3"
                        >
                          <span className="flex-1 truncate">{item.label}</span>
                          <span className="rounded-full bg-white/8 px-2 py-0.5 font-mono text-[9.5px] tracking-wider uppercase">
                            Soon
                          </span>
                        </motion.span>
                      )}
                    </span>
                  </li>
                ),
              )}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}

function SidebarBody({
  onNavigate,
  collapsed,
  onToggle,
}: {
  onNavigate?: () => void
  collapsed?: boolean
  onToggle?: () => void
}) {
  const { profile } = useAuth()
  const reduce = useReducedMotion()

  return (
    <>
      <div
        className={`flex h-[70px] shrink-0 items-center ${
          collapsed ? 'justify-center px-2' : 'justify-between px-5'
        }`}
      >
        {/* Inside the app the logo belongs to the dashboard, not the public site. */}
        <Link to={roleHome(profile?.role, profile?.status)} aria-label="Go to your dashboard">
          {collapsed ? (
            <LogoMark size={32} tone="onDark" />
          ) : (
            <Logo tone="onDark" size={32} showSubtitle={false} />
          )}
        </Link>
        {onToggle && !collapsed && (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Icon name="chevronLeft" size={17} />
          </button>
        )}
      </div>

      {onToggle && collapsed && (
        <button
          type="button"
          onClick={onToggle}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          className="mx-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Icon name="chevronRight" size={17} />
        </button>
      )}

      <NavRows onNavigate={onNavigate} collapsed={collapsed} />

      {!collapsed && (
        <motion.div
          {...(reduce
            ? {}
            : {
                initial: { opacity: 0 },
                animate: { opacity: 1 },
                transition: { duration: 0.26, delay: 0.14, ease: [0.22, 1, 0.36, 1] as const },
              })}
          className="shrink-0 px-3 pb-4"
        >
          <div className="rounded-2xl bg-white/6 p-3.5">
            <p className="eyebrow text-white/40">Effort, not marks</p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/55">
              Collabify records what was done and when. No grade is kept here — that stays
              with your class record.
            </p>
          </div>
        </motion.div>
      )}
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

/**
 * A bar that appears when the connection drops.
 *
 * Everything in this product is a round trip to Supabase, so offline is not a
 * degraded experience, it is a broken one: claims fail, hand-ins fail, and the
 * only clue is an error message that reads as though the app is at fault. This
 * says which it is, and disappears by itself.
 */
function OfflineBar() {
  const [offline, setOffline] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine === false,
  )

  useEffect(() => {
    const on = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  if (!offline) return null

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-amber-400 px-4 py-2 text-center text-[13px] font-medium text-navy-900"
    >
      <Icon name="alert" size={15} className="shrink-0" />
      You are offline. Collabify will keep showing what it already loaded, but nothing you
      change will save until the connection is back.
    </div>
  )
}

const COLLAPSE_KEY = 'collabify.sidebar.collapsed'

export function AppShell() {
  const { profile } = useAuth()
  const reduce = useReducedMotion()
  const [drawer, setDrawer] = useState(false)
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem(COLLAPSE_KEY) === '1',
  )
  const location = useLocation()

  useEffect(() => setDrawer(false), [location.pathname])
  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [drawer])

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  return (
    <div
      // The rail's width is the grid column, so the column is what animates.
      // Everything to the right of it is laid out by the same grid and slides
      // with it for free — animating the aside on its own would have left the
      // page content jumping to the new position a frame later.
      className={`min-h-dvh transition-[grid-template-columns] duration-[320ms] ease-[var(--ease-out-soft)] lg:grid ${
        collapsed ? 'lg:grid-cols-[76px_minmax(0,1fr)]' : 'lg:grid-cols-[276px_minmax(0,1fr)]'
      }`}
    >
      <aside className="sticky top-0 hidden h-dvh flex-col overflow-hidden bg-navy-600 dark:bg-navy-800 lg:flex">
        <SidebarBody collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      </aside>

      {/* The drawer has to survive its own closing animation, which is what
          AnimatePresence is for: React would otherwise unmount it the instant
          the state flips and there would be nothing left to animate out. */}
      <AnimatePresence>
        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.button
              className="absolute inset-0 bg-navy-950/60 backdrop-blur-sm"
              aria-label="Close navigation"
              onClick={() => setDrawer(false)}
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            />
            <motion.div
              className="absolute inset-y-0 left-0 flex w-[280px] flex-col bg-navy-600 shadow-2xl dark:bg-navy-800"
              initial={reduce ? false : { x: '-100%' }}
              animate={{ x: 0 }}
              exit={reduce ? undefined : { x: '-100%' }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            >
              <SidebarBody onNavigate={() => setDrawer(false)} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* clip, not hidden: a wide table can still scroll inside its own box,
          but nothing drags the whole page sideways on a phone. */}
      <div className="flex min-w-0 flex-col overflow-x-clip">
        <OfflineBar />

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
              <Link
                to={roleHome(profile?.role, profile?.status)}
                className="lg:hidden"
                aria-label="Go to your dashboard"
              >
                <Logo size={30} showSubtitle={false} />
              </Link>
            </div>
            <div className="flex items-center gap-1">
              <NotificationBell />
              <ThemeToggle />
              <AccountMenu />
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-7 md:px-7 md:py-9">
          {/* Inside the shell rather than around it: a page that throws leaves
              the rail, the header and the way out alive. Keyed on the path so
              navigating away from a broken page clears the error — otherwise
              the boundary would hold its failure over every page after it. */}
          <ErrorBoundary
            key={location.pathname}
            scope="This page"
            home={roleHome(profile?.role, profile?.status)}
          >
            {/* Inside the boundary, so a chunk that fails to download is caught
                and offers Try again rather than hanging on the spinner. */}
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
