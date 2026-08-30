import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Logo } from '../brand/Logo'
import { Icon } from '../ui/Icon'
import { ThemeToggle } from '../ThemeToggle'
import { Avatar } from './Avatar'
import { NotificationBell } from './NotificationBell'
import { navFor } from './nav'
import type { NavGroup, NavItem } from './nav'
import { useAuth } from '../../context/AuthContext'
import { useUnreadTotal } from '../../hooks/useConversations'
import { roleHome } from '../../lib/roleHome'
import { ROLE_LABEL, fullName } from '../../lib/types'

/**
 * Navigation across the top instead of down the side.
 *
 * Two rows, and they hold different kinds of thing. The upper one is the
 * product and the person: who you are, what has arrived, how it looks. The
 * lower one is where you can go. Keeping them apart is what lets the second row
 * be read as a single list rather than as whatever is left after the utilities.
 *
 * **Not every destination fits a row, and pretending otherwise is the trap.**
 * A professor has thirteen. So the first group — the spine of the product, the
 * four pages the work actually happens on — sits inline, and the rest fold into
 * one menu that keeps their existing group headings. That is a real hierarchy
 * the rail never had to state, because a rail has room to be flat.
 *
 * Messages moves up to the utilities beside the bell. It carries an unread
 * count, and a count nobody can see until they open a menu is not a count.
 */

/** Closes on a click outside or Escape — the two ways anyone dismisses a menu. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

const TAB =
  'relative flex shrink-0 items-center gap-2 border-b-2 px-1 py-3 text-[14px] transition-colors duration-150'

function tabClass(on: boolean) {
  return `${TAB} ${
    on
      ? 'border-navy-600 font-semibold text-ink dark:border-amber-400'
      : 'border-transparent text-muted hover:text-ink'
  }`
}

function MoreMenu({ groups }: { groups: NavGroup[] }) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  const location = useLocation()

  // Shut on navigation. Without this the menu stays open over the page it just
  // sent you to, which reads as the link not having worked.
  useEffect(() => setOpen(false), [location.pathname])

  const here = groups.some((g) =>
    g.items.some((i) => i.to && location.pathname.startsWith(i.to)),
  )

  if (groups.length === 0) return null

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={tabClass(here)}
      >
        More
        <Icon
          name="chevronDown"
          size={15}
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="surface absolute left-0 z-50 mt-1 w-[248px] overflow-hidden rounded-xl border border-line py-1.5 shadow-lift"
        >
          {groups.map((g, n) => (
            <div key={g.title} className={n > 0 ? 'mt-1 border-t border-line pt-1' : ''}>
              <p className="px-4 pt-2 pb-1 text-[11.5px] font-medium tracking-wide text-faint uppercase">
                {g.title}
              </p>
              {g.items.map((item) =>
                item.to ? (
                  <NavLink
                    key={item.label}
                    to={item.to}
                    role="menuitem"
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-4 py-2.5 text-[14px] transition-colors ${
                        isActive
                          ? 'bg-[var(--surface-sunken)] font-semibold text-ink'
                          : 'text-ink hover:bg-[var(--surface-sunken)]'
                      }`
                    }
                  >
                    <Icon name={item.icon} size={17} className="text-muted" />
                    {item.label}
                  </NavLink>
                ) : (
                  <span
                    key={item.label}
                    aria-disabled
                    title="Coming in the next release"
                    className="flex cursor-not-allowed items-center gap-3 px-4 py-2.5 text-[14px] text-faint"
                  >
                    <Icon name={item.icon} size={17} />
                    <span className="flex-1">{item.label}</span>
                    <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px]">
                      Soon
                    </span>
                  </span>
                ),
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
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
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full py-1 pr-1.5 pl-1 transition-colors hover:bg-[var(--surface-sunken)]"
      >
        <Avatar profile={profile} size={30} />
        <span className="hidden max-w-[130px] truncate text-[13.5px] font-medium text-ink lg:block">
          {profile.first_name}
        </span>
        <Icon name="chevronDown" size={15} className="hidden text-faint lg:block" />
      </button>

      {open && (
        <div
          role="menu"
          className="surface absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border border-line shadow-lift"
        >
          <div className="border-b border-line px-4 py-3.5">
            <p className="truncate text-[14px] font-semibold text-ink">{fullName(profile)}</p>
            <p className="truncate text-[12.5px] text-muted">{profile.email}</p>
            <p className="mt-1 text-[12px] text-faint">{ROLE_LABEL[profile.role]}</p>
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

/** The unread count, promoted out of the navigation list into the utilities. */
function MessagesButton({ item }: { item: NavItem }) {
  const { profile } = useAuth()
  const unread = useUnreadTotal(profile?.id)
  if (!item.to) return null

  return (
    <NavLink
      to={item.to}
      aria-label={unread > 0 ? `Messages, ${unread} unread` : 'Messages'}
      className={({ isActive }) =>
        `relative grid h-9 w-9 place-items-center rounded-lg transition-colors ${
          isActive
            ? 'bg-[var(--surface-sunken)] text-ink'
            : 'text-muted hover:bg-[var(--surface-sunken)] hover:text-ink'
        }`
      }
    >
      <Icon name={item.icon} size={19} />
      {unread > 0 && (
        <span className="absolute top-0.5 right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-navy-600 px-1 font-mono text-[9.5px] font-bold text-white dark:bg-amber-400 dark:text-navy-900">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </NavLink>
  )
}

export function TopNav({ onOpenDrawer }: { onOpenDrawer: () => void }) {
  const { profile } = useAuth()
  if (!profile) return null

  const groups = navFor(profile.role)
  // Settings is reachable from the account menu, and Messages from the bell
  // row. Leaving either in the list as well would be two places to press for
  // one destination, which is how a menu stops being trustworthy.
  const messages = groups.flatMap((g) => g.items).find((i) => i.badge === 'messages')
  const rest = groups
    .slice(1)
    .filter((g) => g.title !== 'Account')
    .map((g) => ({ ...g, items: g.items.filter((i) => i.badge !== 'messages') }))
    .filter((g) => g.items.length > 0)

  return (
    <header className="surface sticky top-0 z-40 border-b border-line">
      {/* Matches main's gutters exactly, so the logo and the page title below it
          sit on the same line down the screen. */}
      <div className="w-full px-4 sm:px-6 md:px-8 xl:px-12 2xl:px-20">
        {/* Who you are, what arrived, how it looks. */}
        <div className="flex h-[58px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={onOpenDrawer}
              aria-label="Open navigation"
              className="-ml-2 grid h-10 w-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-[var(--surface-sunken)] md:hidden"
            >
              <Icon name="menu" size={20} />
            </button>
            <Link to={roleHome(profile.role, profile.status)} aria-label="Go to your dashboard">
              <Logo size={28} showSubtitle={false} />
            </Link>
          </div>

          <div className="flex items-center gap-0.5 sm:gap-1">
            {messages && <MessagesButton item={messages} />}
            <NotificationBell />
            <ThemeToggle />
            <AccountMenu />
          </div>
        </div>

        {/* Where you can go.
            The More menu sits OUTSIDE the scrolling strip, and that is not a
            layout preference. `overflow-x: auto` forces the other axis to
            `auto` as well, so a row that scrolls sideways also clips
            everything that hangs below it — the dropdown opened, was cut off
            at the height of the row, and could not even be clicked. Measured,
            not guessed: a hit test at the middle of the open menu found
            nothing there. */}
        <div aria-label="Sections" className="-mb-px hidden items-center gap-6 md:flex">
          <nav className="flex min-w-0 gap-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {groups[0].items.map((item) =>
              item.to ? (
                <NavLink
                  key={item.label}
                  to={item.to}
                  end={item.to.split('/').filter(Boolean).length < 2}
                  className={({ isActive }) => tabClass(isActive)}
                >
                  <Icon name={item.icon} size={17} />
                  {item.label}
                </NavLink>
              ) : null,
            )}
          </nav>
          <MoreMenu groups={rest} />
        </div>
      </div>
    </header>
  )
}
