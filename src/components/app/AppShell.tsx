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
import { useFocusTrap } from '../../lib/focus'
import { roleHome } from '../../lib/roleHome'
import { ROLE_LABEL, fullName } from '../../lib/types'

/**
 * The chrome around every signed-in page.
 *
 * It used to be a navy slab down the left with folding groups and a note about
 * the product at the bottom. It is a quiet white rail now, separated from the
 * page by a hairline, because the person reading this has been here for an hour
 * and the navigation is not what they came for. What is left marks one thing:
 * where you are.
 *
 * The folding groups went with it. They existed to shorten a rail that felt
 * long because it was loud, not because it was long — thirteen rows do not need
 * a mechanism.
 */

function NavRows({
  onNavigate,
  collapsed,
}: {
  onNavigate?: () => void
  collapsed?: boolean
}) {
  const { profile } = useAuth()
  const unreadMessages = useUnreadTotal(profile?.id)

  if (!profile) return null

  return (
    <nav className={`flex-1 space-y-7 overflow-y-auto py-5 ${collapsed ? 'px-3' : 'px-4'}`}>
      {navFor(profile.role).map((group) => (
        <div key={group.title}>
          {/* Collapsed keeps a rule where the heading was, so the grouping,
              which is the only thing the headings were carrying, survives. */}
          {collapsed ? (
            <div className="mx-2 mb-2.5 border-t border-line" />
          ) : (
            <p className="px-3 pb-2 text-[11.5px] font-medium tracking-wide text-faint uppercase">
              {group.title}
            </p>
          )}

          <ul className="space-y-0.5">
            {group.items.map((item) =>
              item.to ? (
                <li key={item.label}>
                  <NavLink
                    to={item.to}
                    // Role homes ("/professor") must match exactly; section roots
                    // ("/professor/classes") stay lit on their detail pages.
                    end={item.to.split('/').filter(Boolean).length < 2}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      `group relative flex items-center rounded-lg py-2 text-[14px] transition-colors duration-150 ${
                        collapsed ? 'justify-center px-0' : 'gap-3 px-3'
                      } ${
                        isActive
                          ? 'bg-[var(--surface-sunken)] font-semibold text-ink'
                          : 'text-muted hover:bg-[var(--surface-sunken)] hover:text-ink'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {/* Where you are, marked once. A filled row plus a
                            coloured icon plus a bar would be three ways of
                            saying it; the bar is the one that survives being
                            glanced at. */}
                        {isActive && (
                          <span
                            aria-hidden
                            className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-amber-400"
                          />
                        )}
                        <Icon
                          name={item.icon}
                          size={18}
                          className={isActive ? 'text-navy-600 dark:text-amber-400' : ''}
                        />
                        {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                        {item.badge === 'messages' &&
                          unreadMessages > 0 &&
                          (collapsed ? (
                            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-400" />
                          ) : (
                            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-navy-600 px-1.5 font-mono text-[10px] font-bold text-white dark:bg-amber-400 dark:text-navy-900">
                              {unreadMessages > 99 ? '99+' : unreadMessages}
                            </span>
                          ))}
                      </>
                    )}
                  </NavLink>
                </li>
              ) : (
                <li key={item.label}>
                  <span
                    aria-disabled
                    title={collapsed ? `${item.label} — coming soon` : 'Coming in the next release'}
                    className={`flex cursor-not-allowed items-center rounded-lg py-2 text-[14px] text-faint ${
                      collapsed ? 'justify-center px-0' : 'gap-3 px-3'
                    }`}
                  >
                    <Icon name={item.icon} size={18} />
                    {!collapsed && (
                      <>
                        <span className="flex-1 truncate">{item.label}</span>
                        <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px]">
                          Soon
                        </span>
                      </>
                    )}
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

  return (
    <>
      <div
        className={`flex h-[60px] shrink-0 items-center border-b border-line ${
          collapsed ? 'justify-center px-2' : 'justify-between px-5'
        }`}
      >
        {/* Inside the app the logo belongs to the dashboard, not the public site. */}
        <Link to={roleHome(profile?.role, profile?.status)} aria-label="Go to your dashboard">
          {collapsed ? <LogoMark size={28} /> : <Logo size={28} showSubtitle={false} />}
        </Link>
        {onToggle && !collapsed && (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
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
          className="mx-auto mt-3 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
        >
          <Icon name="chevronRight" size={17} />
        </button>
      )}

      <NavRows onNavigate={onNavigate} collapsed={collapsed} />
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
        <Avatar profile={profile} size={32} />
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
          className="surface absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border border-line shadow-lift"
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
  const drawerPanel = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem(COLLAPSE_KEY) === '1',
  )
  const location = useLocation()

  useEffect(() => setDrawer(false), [location.pathname])
  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : ''
    if (!drawer) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false)
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKey)
    }
  }, [drawer])

  useFocusTrap(drawerPanel, drawer)

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  return (
    <div
      // `app-ui` is what swaps the whole token set for the signed-in side: white
      // ground, hairlines instead of shadows. The landing page never carries it.
      //
      // The rail's width is the grid column, so the column is what animates.
      // Everything to the right is laid out by the same grid and slides with it
      // for free — animating the aside alone left the page content jumping to
      // its new position a frame later.
      className={`app-ui min-h-dvh transition-[grid-template-columns] duration-[320ms] ease-[var(--ease-out-soft)] lg:grid ${
        collapsed ? 'lg:grid-cols-[68px_minmax(0,1fr)]' : 'lg:grid-cols-[248px_minmax(0,1fr)]'
      }`}
    >
      {/* First tab stop on every page. The rail is a dozen links, and without
          this a keyboard user walks all of them again on every navigation. */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <aside
        aria-label="Main navigation"
        className="surface sticky top-0 hidden h-dvh flex-col overflow-hidden border-r border-line lg:flex"
      >
        <SidebarBody collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      </aside>

      {/* The drawer has to survive its own closing animation, which is what
          AnimatePresence is for: React would otherwise unmount it the instant
          the state flips and there would be nothing left to animate out. */}
      <AnimatePresence>
        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              className="absolute inset-0 bg-navy-950/45 backdrop-blur-sm"
              aria-hidden="true"
              onClick={() => setDrawer(false)}
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            />
            <motion.div
              ref={drawerPanel}
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              className="app-ui surface absolute inset-y-0 left-0 flex w-[272px] flex-col border-r border-line"
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
          <div className="flex h-[60px] items-center justify-between gap-3 px-4 md:px-8">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setDrawer(true)}
                aria-label="Open navigation"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-[var(--surface-sunken)] lg:hidden"
              >
                <Icon name="menu" size={20} />
              </button>
              <Link
                to={roleHome(profile?.role, profile?.status)}
                className="lg:hidden"
                aria-label="Go to your dashboard"
              >
                <Logo size={26} showSubtitle={false} />
              </Link>
            </div>
            <div className="flex items-center gap-1">
              <NotificationBell />
              <ThemeToggle />
              <AccountMenu />
            </div>
          </div>
        </header>

        {/* tabIndex -1 so the skip link can actually move focus here, not just
            scroll — without it the next Tab starts from the top of the rail
            again and the link achieves nothing. */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 px-4 py-6 outline-none md:px-8 md:py-8"
        >
          <div className="mx-auto w-full max-w-[1120px]">
            {/* Inside the shell rather than around it: a page that throws leaves
                the rail, the header and the way out alive. Keyed on the path so
                navigating away from a broken page clears the error — otherwise
                the boundary would hold its failure over every page after it. */}
            <ErrorBoundary
              key={location.pathname}
              scope="This page"
              home={roleHome(profile?.role, profile?.status)}
            >
              {/* Inside the boundary, so a chunk that fails to download is
                  caught and offers Try again rather than hanging on a spinner. */}
              <Suspense fallback={<PageLoading />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  )
}
