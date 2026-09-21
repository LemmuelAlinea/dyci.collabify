import { Suspense, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { GeneralNavigationProvider } from '../../context/GeneralNavigationContext'
import { useFocusTrap } from '../../lib/focus'
import { homeFor, workplaceOf } from '../../lib/workplace'
import { Logo } from '../brand/Logo'
import { Icon } from '../ui/Icon'
import { PageLoading } from '../ui/PageLoading'
import { ErrorBoundary } from './ErrorBoundary'
import { SideNav } from './SideNav'
import { TopNav } from './TopNav'

const COLLAPSED_KEY = 'collabify:sidebar-collapsed'

function initialCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

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
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const drawerPanel = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const workplace = workplaceOf(location.pathname, profile?.home_workplace ?? 'education')

  useEffect(() => setDrawer(false), [location.pathname, location.search])
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, String(collapsed))
    } catch {
      // A private window may refuse persistence; the navigation still works.
    }
  }, [collapsed])
  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : ''
    if (!drawer) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setDrawer(false)
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKey)
    }
  }, [drawer])

  useFocusTrap(drawerPanel, drawer)

  return (
    <GeneralNavigationProvider enabled={workplace === 'general'}>
      <div className="app-ui flex min-h-dvh overflow-x-clip">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>

        <aside
          id="desktop-side-navigation"
          className={`surface relative sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line lg:flex ${
            collapsed ? 'w-16' : 'w-[276px]'
          } ${reduce ? '' : 'transition-[width] duration-200'}`}
        >
          <SideNav collapsed={collapsed} />
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-expanded={!collapsed}
            aria-controls="desktop-side-navigation"
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            className="absolute top-1/2 -right-3.5 z-10 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full transition-transform hover:scale-105 focus:outline-none active:scale-95"
          >
            <img
              src="/collapse_button.png"
              alt=""
              className={`h-full w-full object-contain ${collapsed ? 'rotate-180' : ''}`}
            />
          </button>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <OfflineBar />
          <TopNav onOpenDrawer={() => setDrawer(true)} />

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
                  animate={{ transform: 'translateX(0%)' }}
                  exit={reduce ? undefined : { transform: 'translateX(-100%)' }}
                  transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="flex h-[58px] shrink-0 items-center justify-between border-b border-white/10 bg-navy-950 px-4 text-amber-50">
                    <Link
                      to={workplace === 'general' ? '/general' : homeFor(profile)}
                      aria-label="Go to your dashboard"
                    >
                      <Logo size={26} tone="onDark" showSubtitle={false} />
                    </Link>
                    <button
                      type="button"
                      onClick={() => setDrawer(false)}
                      aria-label="Close navigation"
                      className="grid h-9 w-9 place-items-center rounded-lg text-amber-50/60 hover:bg-white/10 hover:text-amber-50"
                    >
                      <Icon name="x" size={19} />
                    </button>
                  </div>
                  <SideNav onNavigate={() => setDrawer(false)} showLogo={false} />
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          <main
            id="main-content"
            tabIndex={-1}
            className="flex-1 px-4 py-6 outline-none sm:px-6 md:px-8 md:py-8 xl:px-10 2xl:px-12"
          >
            <div className="w-full">
              <ErrorBoundary key={location.pathname} scope="This page" home={homeFor(profile)}>
                <Suspense fallback={<PageLoading />}>
                  <Outlet />
                </Suspense>
              </ErrorBoundary>
            </div>
          </main>
        </div>
      </div>
    </GeneralNavigationProvider>
  )
}
