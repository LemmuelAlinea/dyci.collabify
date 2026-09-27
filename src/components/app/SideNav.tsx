import { useEffect, useState } from 'react'
import type { FocusEvent, MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { useAdmission } from '../../hooks/useAdmission'
import { useUnreadTotal } from '../../hooks/useConversations'
import { recentProjects } from '../../lib/general/dashboard'
import { paths } from '../../lib/paths'
import { Logo, LogoMark } from '../brand/Logo'
import { Icon } from '../ui/Icon'
import { membershipOf, navFor } from './nav'
import type { NavGroup, NavItem } from './nav'
import { classRows, spaceAndClassRows, workSpaceRows } from './spaceRows'
import type { LiveRow } from './spaceRows'

type Hint = { text: string; top: number }

// No font-size here on purpose: each kind of row sets its own, and two
// arbitrary text-[] utilities on one element resolve by stylesheet order.
const ROW = 'relative flex w-full items-center rounded-lg transition-colors'
const ACTIVE = 'surface-sunken font-semibold text-ink'
const IDLE = 'font-medium text-muted hover:bg-[var(--surface-sunken)] hover:text-ink'

export function SideNav({
  collapsed = false,
  onNavigate,
  showLogo = true,
}: {
  collapsed?: boolean
  onNavigate?: () => void
  showLogo?: boolean
}) {
  const { profile } = useAuth()
  const location = useLocation()
  const navigation = useGeneralNavigation()
  const [hint, setHint] = useState<Hint | null>(null)

  const unread = useUnreadTotal(profile?.id, 'all')
  const admitted = useAdmission(profile?.role === 'student' ? profile.id : undefined)

  useEffect(() => setHint(null), [collapsed, location.pathname, location.search])

  if (!profile) return null

  // Null while it loads counts as admitted, so the rail never flashes empty
  // for a student who has classes.
  const groups = navFor(
    profile,
    admitted !== false,
    membershipOf(navigation.spaces, navigation.myProjects),
  )

  function revealHint(
    text: string,
    event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>,
  ) {
    if (!collapsed) return
    const rect = event.currentTarget.getBoundingClientRect()
    setHint({ text, top: rect.top + rect.height / 2 })
  }

  function hintHandlers(text: string) {
    return {
      'aria-describedby': collapsed ? 'side-nav-tooltip' : undefined,
      onMouseEnter: (event: MouseEvent<HTMLElement>) => revealHint(text, event),
      onMouseLeave: () => setHint(null),
      onFocus: (event: FocusEvent<HTMLElement>) => revealHint(text, event),
      onBlur: () => setHint(null),
    }
  }

  const spaces = navigation.spaces ?? []
  const liveProjects = (navigation.myProjects ?? []).filter(
    (project) => project.my_level && !project.archived_at,
  )

  function live({ live: kind, withClasses }: NavGroup): { rows: LiveRow[]; loading: boolean } {
    if (kind === 'projects') {
      return {
        loading: navigation.myProjects === null,
        rows: recentProjects(liveProjects).map((project) => ({
          id: project.id,
          name: project.name,
          to: paths.project(project.id),
        })),
      }
    }
    return {
      loading: navigation.spaces === null,
      rows:
        kind === 'classes'
          ? classRows(spaces)
          : withClasses
            ? spaceAndClassRows(spaces)
            : workSpaceRows(spaces),
    }
  }

  return (
    <>
      <nav
        aria-label="Primary"
        className={`flex min-h-0 flex-1 flex-col overflow-y-auto py-4 ${collapsed ? 'px-2' : 'px-4'}`}
      >
        <div className="space-y-5">
          {showLogo && (
            <Link
              to={paths.home}
              aria-label="Go to your dashboard"
              onClick={onNavigate}
              className={`mb-1 flex shrink-0 items-center ${collapsed ? 'justify-center' : 'px-1'}`}
            >
              {collapsed ? (
                <LogoMark size={30} tone="brand" />
              ) : (
                <Logo size={24} tone="brand" showSubtitle={false} />
              )}
            </Link>
          )}

          {groups.map((group) => {
            const { rows, loading } = group.live ? live(group) : { rows: [], loading: false }
            // Hidden while loading too, so a student with no spaces never sees
            // the section flash in and back out.
            if (group.hideWhenEmpty && (loading || rows.length === 0)) return null

            return (
              <div key={group.title}>
                {!collapsed && (
                  <GroupHeader title={group.title} more={group.more} onNavigate={onNavigate} />
                )}
                <ul className="space-y-0.5">
                  {rows.map((row) => (
                    <LiveRowLink
                      key={row.id}
                      row={row}
                      collapsed={collapsed}
                      onNavigate={onNavigate}
                      hintHandlers={hintHandlers}
                    />
                  ))}

                  {/* Classes always has its own rows below, so it needs no
                      empty line; Spaces and Projects do. */}
                  {!collapsed && group.live && group.items.length === 0 && rows.length === 0 && !loading && (
                    <li className="px-3 py-1 text-[13px] text-faint">
                      {group.live === 'projects' ? 'No projects yet.' : 'No spaces yet.'}
                    </li>
                  )}

                  {/* Collapsed there is no header to hang the link on. */}
                  {collapsed && group.more && (
                    <MoreRow
                      more={group.more}
                      onNavigate={onNavigate}
                      hintHandlers={hintHandlers}
                    />
                  )}

                  {rows.length > 0 && group.items.length > 0 && (
                    <li aria-hidden className={`my-2 border-t border-line ${collapsed ? 'mx-2' : 'mx-3'}`} />
                  )}

                  {group.items.map((item) => (
                    <StaticRow
                      key={item.label}
                      item={item}
                      collapsed={collapsed}
                      unread={unread}
                      onNavigate={onNavigate}
                      hintHandlers={hintHandlers}
                    />
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </nav>

      {collapsed && hint && typeof document !== 'undefined'
        ? createPortal(
            <div
              id="side-nav-tooltip"
              role="tooltip"
              style={{ top: hint.top }}
              className="surface fixed left-[72px] z-[100] -translate-y-1/2 rounded-md border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink shadow-lift"
            >
              {hint.text}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

/**
 * One of the reader's own things — a class, space or project.
 *
 * Collapsed, a row is its first letter rather than an icon: five identical
 * folder glyphs tell nobody which space is which, and the tooltip carries the
 * full name either way.
 */
function LiveRowLink({
  row,
  collapsed,
  onNavigate,
  hintHandlers,
}: {
  row: LiveRow
  collapsed: boolean
  onNavigate?: () => void
  hintHandlers: (text: string) => Record<string, unknown>
}) {
  return (
    <li>
      <NavLink
        to={row.to}
        onClick={onNavigate}
        aria-label={collapsed ? row.name : undefined}
        {...hintHandlers(row.name)}
        className={({ isActive }) =>
          `${ROW} h-9 text-[14px] ${collapsed ? 'justify-center' : 'gap-3 px-3'} ${
            isActive ? ACTIVE : IDLE
          }`
        }
      >
        {({ isActive }) => (
          <>
            {isActive && <ActiveBar />}
            <span
              aria-hidden
              className={`grid h-5 w-5 shrink-0 place-items-center rounded font-mono text-[10px] font-bold ${
                isActive
                  ? 'bg-navy-600 text-white dark:bg-amber-400 dark:text-navy-900'
                  : row.tone === 'education'
                    ? 'bg-amber-400/18 text-amber-700 dark:text-amber-300'
                    : 'border border-line text-muted'
              }`}
            >
              {row.name.trim().charAt(0).toUpperCase()}
            </span>
            {!collapsed && <span className="flex-1 truncate">{row.name}</span>}
          </>
        )}
      </NavLink>
    </li>
  )
}

/** The link to every class, space or project, as a row — collapsed rail only. */
function MoreRow({
  more,
  onNavigate,
  hintHandlers,
}: {
  more: { to: string; label: string }
  onNavigate?: () => void
  hintHandlers: (text: string) => Record<string, unknown>
}) {
  return (
    <li>
      {/* `end`, so the list page lights this row while a project or space
          below it lights its own. */}
      <NavLink
        to={more.to}
        end
        onClick={onNavigate}
        aria-label={more.label}
        {...hintHandlers(more.label)}
        className={({ isActive }) => `${ROW} h-9 justify-center ${isActive ? ACTIVE : 'text-faint hover:bg-[var(--surface-sunken)] hover:text-ink'}`}
      >
        <Icon name="arrowRight" size={16} className="shrink-0" />
      </NavLink>
    </li>
  )
}

/**
 * The rail reads in three steps, and each one differs in more than colour:
 *
 *   label   11px  semibold  text-faint  uppercase, tracked — structure, not a place
 *   row     14px  medium    text-muted  every destination, fixed or live alike
 *   active  14px  semibold  text-ink    plus the amber bar and a lit icon
 *
 * The link to all of a section's things sits in its header at 12px text-faint,
 * so the list ends on the reader's own rows instead of on one more row.
 */
function GroupHeader({
  title,
  more,
  onNavigate,
}: {
  title: string
  more?: { to: string; label: string }
  onNavigate?: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 pb-2">
      <p className="text-[11px] font-semibold tracking-[0.1em] text-faint uppercase">{title}</p>
      {more && (
        <NavLink
          to={more.to}
          end
          onClick={onNavigate}
          aria-label={more.label}
          className={({ isActive }) =>
            `-my-1 flex items-center gap-1 rounded px-1 py-1 text-[12px] transition-colors ${
              isActive ? 'font-semibold text-ink' : 'text-faint hover:text-ink'
            }`
          }
        >
          All
          <Icon name="arrowRight" size={12} />
        </NavLink>
      )}
    </div>
  )
}

function ActiveBar() {
  return (
    <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-amber-400" />
  )
}

function StaticRow({
  item,
  collapsed,
  unread,
  onNavigate,
  hintHandlers,
}: {
  item: NavItem
  collapsed: boolean
  unread: number
  onNavigate?: () => void
  hintHandlers: (text: string) => Record<string, unknown>
}) {
  const label = item.badge === 'messages' && unread > 0
    ? `${item.label}, ${unread} unread`
    : item.label

  if (!item.to) {
    return (
      <li>
        <span
          aria-disabled
          aria-label={collapsed ? item.label : undefined}
          {...hintHandlers(item.label)}
          className={`${ROW} h-10 text-[14px] ${collapsed ? 'justify-center' : 'gap-3 px-3'} cursor-not-allowed text-faint`}
        >
          <Icon name={item.icon} size={18} />
          {!collapsed && (
            <>
              <span className="flex-1 truncate">{item.label}</span>
              <span className="rounded-full border border-line px-1.5 py-0.5 text-[12px]">Soon</span>
            </>
          )}
        </span>
      </li>
    )
  }

  return (
    <li>
      <NavLink
        to={item.to}
        end={item.end}
        onClick={onNavigate}
        aria-label={collapsed ? label : undefined}
        {...hintHandlers(item.label)}
        className={({ isActive }) =>
          `${ROW} h-10 text-[14px] ${collapsed ? 'justify-center' : 'gap-3 px-3'} ${
            isActive ? ACTIVE : IDLE
          }`
        }
      >
        {({ isActive }) => (
          <>
            {isActive && <ActiveBar />}
            <Icon
              name={item.icon}
              size={18}
              className={isActive ? 'text-navy-600 dark:text-amber-400' : ''}
            />
            {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
            {item.badge === 'messages' && unread > 0 && (
              <span
                aria-hidden
                className={`grid place-items-center rounded-full bg-navy-600 font-mono text-[12px] font-bold text-white dark:bg-amber-400 dark:text-navy-900 ${
                  collapsed
                    ? 'absolute top-0.5 right-0.5 h-4 min-w-4 px-1'
                    : 'h-5 min-w-5 px-1.5'
                }`}
              >
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </>
        )}
      </NavLink>
    </li>
  )
}

