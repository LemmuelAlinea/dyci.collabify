import { Suspense, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Logo } from '../brand/Logo'
import { Icon } from '../ui/Icon'
import { PageLoading } from '../ui/PageLoading'
import { ErrorBoundary } from './ErrorBoundary'
import { TopNav } from './TopNav'
import { navFor } from './nav'
import { useAuth } from '../../context/AuthContext'
import { useUnreadTotal } from '../../hooks/useConversations'
import { useFocusTrap } from '../../lib/focus'
import { roleHome } from '../../lib/roleHome'

/**
 * The chrome around every signed-in page.
 *
 * It was a navy rail down the left. It is a top bar now — the navigation is two
 * rows across the top and the page gets the full width underneath, which is
 * what a page of dense content wants. A rail spends 250px of every screen on
 * thirteen links somebody uses once a session.
 *
 * On a phone the bar keeps only its top row, and the full list lives in a
 * drawer: a tab row that scrolls sideways hides exactly the items nobody
 * thought to scroll for.
 */

/** Every destination, grouped, for the phone drawer. */
function DrawerNav({ onNavigate }: { onNavigate: () => void }) {
  const { profile } = useAuth()
  const unread = useUnreadTotal(profile?.id)
  if (!profile) return null

  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
      {navFor(profile.role).map((group) => (
        <div key={group.title}>
          <p className="px-3 pb-1.5 text-[11.5px] font-medium tracking-wide text-faint uppercase">
            {group.title}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) =>
              item.to ? (
                <li key={item.label}>
                  <NavLink
                    to={item.to}
                    end={item.to.split('/').filter(Boolean).length < 2}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14.5px] transition-colors ${
                        isActive
                          ? 'bg-[var(--surface-sunken)] font-semibold text-ink'
                          : 'text-muted hover:bg-[var(--surface-sunken)] hover:text-ink'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <span
                            aria-hidden
                            className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-amber-400"
                          />
                        )}
                        <Icon
                          name={item.icon}
                          size={18}
                          className={isActive ? 'text-navy-600 dark:text-amber-400' : ''}
                        />
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.badge === 'messages' && unread > 0 && (
                          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-navy-600 px-1.5 font-mono text-[10px] font-bold text-white dark:bg-amber-400 dark:text-navy-900">
                            {unread > 99 ? '99+' : unread}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                </li>
              ) : (
                <li key={item.label}>
                  <span
                    aria-disabled
                    className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-[14.5px] text-faint"
                  >
                    <Icon name={item.icon} size={18} />
                    <span className="flex-1 truncate">{item.label}</span>
                    <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px]">
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

export function AppShell() {
  const { profile } = useAuth()
  const reduce = useReducedMotion()
  const [drawer, setDrawer] = useState(false)
  const drawerPanel = useRef<HTMLDivElement>(null)
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

  return (
    // `app-ui` is what swaps the whole token set for the signed-in side: white
    // ground, hairlines instead of shadows. The landing page never carries it.
    //
    // clip, not hidden: a wide table can still scroll inside its own box, but
    // nothing drags the whole page sideways on a phone.
    <div className="app-ui flex min-h-dvh flex-col overflow-x-clip">
      {/* First tab stop on every page — without it a keyboard user walks the
          whole nav again on every navigation. */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <OfflineBar />
      <TopNav onOpenDrawer={() => setDrawer(true)} />

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
              className="app-ui surface absolute inset-y-0 left-0 flex w-[276px] flex-col border-r border-line"
              initial={reduce ? false : { transform: 'translateX(-100%)' }}
              animate={{ transform: 'translateX(0)' }}
              exit={reduce ? undefined : { transform: 'translateX(-100%)' }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="flex h-[58px] shrink-0 items-center justify-between border-b border-line px-4">
                <Link
                  to={roleHome(profile?.role, profile?.status)}
                  aria-label="Go to your dashboard"
                >
                  <Logo size={26} showSubtitle={false} />
                </Link>
                <button
                  type="button"
                  onClick={() => setDrawer(false)}
                  aria-label="Close navigation"
                  className="grid h-9 w-9 place-items-center rounded-lg text-faint hover:bg-[var(--surface-sunken)] hover:text-ink"
                >
                  <Icon name="x" size={19} />
                </button>
              </div>
              <DrawerNav onNavigate={() => setDrawer(false)} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* tabIndex -1 so the skip link can actually move focus here, not just
          scroll — without it the next Tab starts from the top of the nav again
          and the link achieves nothing. */}
      {/* No width cap. A fixed column left a third of a wide screen empty while
          the tables inside it scrolled — the page was narrow because of a
          number, not because anything needed to be. The gutters grow with the
          screen instead, and the things that genuinely have a comfortable
          maximum say so themselves: a paragraph caps at 62ch wherever it is. */}
      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 px-4 py-6 outline-none sm:px-6 md:px-8 md:py-8 xl:px-12 2xl:px-20"
      >
        <div className="w-full">
          {/* Inside the shell rather than around it: a page that throws leaves
              the navigation, the header and the way out alive. Keyed on the
              path so navigating away from a broken page clears the error —
              otherwise the boundary would hold its failure over every page
              after it. */}
          <ErrorBoundary
            key={location.pathname}
            scope="This page"
            home={roleHome(profile?.role, profile?.status)}
          >
            {/* Inside the boundary, so a chunk that fails to download is caught
                and offers Try again rather than hanging on a spinner. */}
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>
    </div>
  )
}
