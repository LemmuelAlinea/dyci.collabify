import { Fragment, useEffect, useState } from 'react'
import type { FocusEvent, MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { useAdmission } from '../../hooks/useAdmission'
import { useUnreadTotal } from '../../hooks/useConversations'
import { recentProjects } from '../../lib/general/dashboard'
import { educationHome, homeFor, workplaceOf } from '../../lib/workplace'
import { Logo, LogoMark } from '../brand/Logo'
import { Icon } from '../ui/Icon'
import { WorkplaceSwitcher } from './WorkplaceSwitcher'
import { navForWorkplace } from './nav'
import type { NavItem } from './nav'

type Hint = { text: string; top: number }

// No font-size here on purpose: each kind of row sets its own, and two
// arbitrary text-[] utilities on one element resolve by stylesheet order.
const ROW = 'relative flex w-full items-center rounded-lg transition-colors'

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

  const workplace = profile ? workplaceOf(location.pathname, profile.home_workplace) : 'education'
  const unread = useUnreadTotal(profile?.id, workplace === 'general' ? 'general' : 'education')
  const admitted = useAdmission(profile?.role === 'student' ? profile.id : undefined)

  useEffect(() => setHint(null), [collapsed, location.pathname, location.search])

  if (!profile) return null

  // Null while it loads counts as admitted, so the rail never flashes empty
  // for a student who has classes.
  const groups = navForWorkplace(
    workplace,
    profile.status === 'active' ? profile.role : null,
    admitted !== false,
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

  const liveSpaces = (navigation.spaces ?? []).filter(
    (space) => space.my_level && !space.archived_at,
  )
  const liveProjects = (navigation.myProjects ?? []).filter(
    (project) => project.my_level && !project.archived_at,
  )

  const home = workplace === 'general' ? '/general' : homeFor(profile)

  return (
    <>
      <nav
        aria-label="Primary"
        className={`flex min-h-0 flex-1 flex-col overflow-y-auto py-4 ${collapsed ? 'px-2' : 'px-4'}`}
      >
        <div className="space-y-5">
          {showLogo && (
            <Link
              to={home}
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

          {collapsed ? (
            <div className="space-y-1" aria-label="Workplace">
              <NavLink
                to={educationHome(profile)}
                aria-label="Education workplace"
                {...hintHandlers('Education')}
                className={({ isActive }) =>
                  `${ROW} h-10 text-[14px] justify-center ${
                    isActive && workplace === 'education'
                      ? 'surface-sunken text-navy-600 dark:text-amber-400'
                      : 'text-muted hover:bg-[var(--surface-sunken)] hover:text-ink'
                  }`
                }
              >
                <Icon name="board" size={18} />
              </NavLink>
              <NavLink
                to="/general"
                aria-label="General workplace"
                {...hintHandlers('General')}
                className={({ isActive }) =>
                  `${ROW} h-10 text-[14px] justify-center ${
                    (isActive || workplace === 'general')
                      ? 'surface-sunken text-navy-600 dark:text-amber-400'
                      : 'text-muted hover:bg-[var(--surface-sunken)] hover:text-ink'
                  }`
                }
              >
                <Icon name="kanban" size={18} />
              </NavLink>
            </div>
          ) : (
            <WorkplaceSwitcher tone="surface" />
          )}

          {groups.map((group, index) => (
            <Fragment key={group.title}>
              <div>
                {!collapsed && <GroupLabel>{group.title}</GroupLabel>}
                <ul className="space-y-0.5">
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

              {/* The reader's own work, between the fixed rows and Account.
                  These lists change as the work does, which is the one kind of
                  movement a rail should have. Spaces first: a space holds
                  projects, so the rail reads widest to narrowest. */}
              {workplace === 'general' && index === 0 && (
                <>
                  <LiveGroup
                    title="Your spaces"
                    empty="No spaces yet."
                    moreTo="/general/spaces"
                    moreLabel="All spaces"
                    collapsed={collapsed}
                    loading={navigation.spaces === null}
                    onNavigate={onNavigate}
                    hintHandlers={hintHandlers}
                    rows={liveSpaces.slice(0, 4).map((space) => ({
                      id: space.id,
                      name: space.name,
                      to: `/general/spaces/${space.id}`,
                    }))}
                  />
                  <LiveGroup
                    title="Your projects"
                    empty="No projects yet."
                    moreTo="/general/projects"
                    moreLabel="All projects"
                    collapsed={collapsed}
                    loading={navigation.myProjects === null}
                    onNavigate={onNavigate}
                    hintHandlers={hintHandlers}
                    rows={recentProjects(liveProjects).map((project) => ({
                      id: project.id,
                      name: project.name,
                      to: `/general/projects/${project.id}`,
                    }))}
                  />
                </>
              )}
            </Fragment>
          ))}
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
 * A named list of the reader's own things — projects, spaces — ending in a link
 * to all of them.
 *
 * Collapsed, a row is its first letter rather than an icon: five identical
 * folder glyphs tell nobody which space is which, and the tooltip carries the
 * full name either way.
 */
function LiveGroup({
  title,
  empty,
  rows,
  moreTo,
  moreLabel,
  collapsed,
  loading,
  onNavigate,
  hintHandlers,
}: {
  title: string
  empty: string
  rows: { id: string; name: string; to: string }[]
  moreTo: string
  moreLabel: string
  collapsed: boolean
  loading: boolean
  onNavigate?: () => void
  hintHandlers: (text: string) => Record<string, unknown>
}) {
  return (
    <div>
      {!collapsed && <GroupLabel>{title}</GroupLabel>}
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <li key={row.id}>
            <NavLink
              to={row.to}
              onClick={onNavigate}
              aria-label={collapsed ? row.name : undefined}
              {...hintHandlers(row.name)}
              className={({ isActive }) =>
                `${ROW} h-9 text-[13.5px] ${collapsed ? 'justify-center' : 'gap-3 px-3'} ${
                  isActive
                    ? 'surface-sunken font-semibold text-ink'
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
                  <span
                    aria-hidden
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded font-mono text-[10px] font-bold ${
                      isActive
                        ? 'bg-navy-600 text-white dark:bg-amber-400 dark:text-navy-900'
                        : 'surface-sunken text-muted'
                    }`}
                  >
                    {row.name.trim().charAt(0).toUpperCase()}
                  </span>
                  {!collapsed && <span className="flex-1 truncate">{row.name}</span>}
                </>
              )}
            </NavLink>
          </li>
        ))}

        {!collapsed && rows.length === 0 && !loading && (
          <li className="px-3 py-1 text-[13px] text-faint">{empty}</li>
        )}

        <li>
          {/* `end`, so the list page lights this row while a project or space
              below it lights its own. */}
          <NavLink
            to={moreTo}
            end
            onClick={onNavigate}
            aria-label={collapsed ? moreLabel : undefined}
            {...hintHandlers(moreLabel)}
            className={({ isActive }) =>
              `${ROW} h-9 ${collapsed ? 'justify-center' : 'gap-3 px-3'} text-[12.5px] ${
                isActive
                  ? 'surface-sunken font-semibold text-ink'
                  : 'text-faint hover:bg-[var(--surface-sunken)] hover:text-ink'
              }`
            }
          >
            <Icon name="arrowRight" size={16} className="shrink-0" />
            {!collapsed && <span className="flex-1 truncate">{moreLabel}</span>}
          </NavLink>
        </li>
      </ul>
    </div>
  )
}

/**
 * The rail reads in four steps, and each one is a step down in size, weight and
 * colour together: a section label, the rows that go somewhere fixed, the
 * reader's own things, then the way to all of them.
 *
 *   label   11px  semibold  text-faint   (uppercase, tracked)
 *   fixed   14px  medium    text-ink
 *   live  13.5px  normal    text-muted
 *   more  12.5px  normal    text-faint
 *
 * Whichever row is active takes text-ink and semibold wherever it sits, so the
 * current page reads above its own level without another colour.
 */
function GroupLabel({ children }: { children: string }) {
  return (
    <p className="px-3 pb-2 text-[11px] font-semibold tracking-[0.1em] text-faint uppercase">
      {children}
    </p>
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
        end={item.end ?? item.to.split('/').filter(Boolean).length < 2}
        onClick={onNavigate}
        aria-label={collapsed ? label : undefined}
        {...hintHandlers(item.label)}
        className={({ isActive }) =>
          `${ROW} h-10 text-[14px] ${collapsed ? 'justify-center' : 'gap-3 px-3'} ${
            isActive
              ? 'surface-sunken font-semibold text-ink'
              : 'font-medium text-ink hover:bg-[var(--surface-sunken)]'
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

