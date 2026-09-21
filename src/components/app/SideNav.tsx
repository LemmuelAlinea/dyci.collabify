import { Fragment, useEffect, useState } from 'react'
import type { FocusEvent, MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { useUnreadTotal } from '../../hooks/useConversations'
import { rememberSpace } from '../../hooks/useSpaces'
import { educationHome, homeFor, workplaceOf } from '../../lib/workplace'
import { Logo, LogoMark } from '../brand/Logo'
import { NewSpaceDialog } from '../general/SpaceDialogs'
import { Icon } from '../ui/Icon'
import { WorkplaceSwitcher } from './WorkplaceSwitcher'
import { navForWorkplace } from './nav'
import type { NavItem } from './nav'

type Hint = { text: string; top: number }

const ROW = 'relative flex w-full items-center rounded-lg text-[14px] transition-colors'

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
  const navigate = useNavigate()
  const navigation = useGeneralNavigation()
  const [spaceOpen, setSpaceOpen] = useState(false)
  const [newSpaceOpen, setNewSpaceOpen] = useState(false)
  const [hint, setHint] = useState<Hint | null>(null)

  const workplace = profile ? workplaceOf(location.pathname, profile.home_workplace) : 'education'
  const unread = useUnreadTotal(profile?.id, workplace === 'general' ? 'general' : 'education')

  useEffect(() => setHint(null), [collapsed, location.pathname, location.search])

  if (!profile) return null

  const groups = navForWorkplace(
    workplace,
    profile.status === 'active' ? profile.role : null,
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

  function chooseSpace(spaceId: string) {
    rememberSpace(spaceId)
    setSpaceOpen(false)
    navigate(`/general/spaces/${spaceId}`)
    onNavigate?.()
  }

  function openCreateSpace() {
    setSpaceOpen(false)
    setNewSpaceOpen(true)
  }

  const liveSpaces = (navigation.spaces ?? []).filter(
    (space) => space.my_level && !space.archived_at,
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
                  `${ROW} h-10 justify-center ${
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
                  `${ROW} h-10 justify-center ${
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

          {workplace === 'general' && (
            <div className="space-y-5">
              <div>
                {!collapsed && <GroupLabel>Space</GroupLabel>}
                <button
                  type="button"
                  onClick={() => setSpaceOpen((value) => !value)}
                  aria-label={navigation.currentSpace?.name ?? 'Choose a space'}
                  aria-expanded={spaceOpen}
                  {...hintHandlers(navigation.currentSpace?.name ?? 'Choose a space')}
                  className={`${ROW} h-10 ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} surface-sunken text-navy-700 dark:text-navy-200`}
                >
                  <Icon name="folder" size={18} className="shrink-0 text-navy-600 dark:text-amber-400" />
                  {!collapsed && (
                    <>
                      <span className="min-w-0 flex-1 truncate text-left font-medium">
                        {navigation.currentSpace?.name ?? 'Choose a space'}
                      </span>
                      <Icon
                        name="chevronDown"
                        size={15}
                        className={`shrink-0 text-faint transition-transform ${spaceOpen ? 'rotate-180' : ''}`}
                      />
                    </>
                  )}
                </button>
                {spaceOpen && !collapsed && (
                  <div className="mt-2 overflow-hidden rounded-xl border border-line bg-[var(--surface)] shadow-sm">
                    <div className="border-b border-line px-3 py-2">
                      <p className="text-[11px] font-medium tracking-wide text-faint uppercase">
                        Spaces
                      </p>
                    </div>
                    <div className="max-h-64 overflow-y-auto py-1">
                      {liveSpaces.length === 0 ? (
                        <p className="px-3 py-3 text-[13px] text-muted">No active spaces yet.</p>
                      ) : (
                        liveSpaces.map((space) => (
                          <button
                            type="button"
                            key={space.id}
                            onClick={() => chooseSpace(space.id)}
                            aria-current={space.id === navigation.currentSpaceId ? 'page' : undefined}
                            className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                              space.id === navigation.currentSpaceId
                                ? 'bg-[var(--surface)] text-amber-500 dark:text-amber-400'
                                : 'text-muted hover:bg-[var(--surface-sunken)] hover:text-navy-700 dark:hover:text-navy-200'
                            }`}
                          >
                            <Icon
                              name="folder"
                              size={17}
                              className={`shrink-0 ${
                                space.id === navigation.currentSpaceId
                                  ? 'text-amber-500 dark:text-amber-400'
                                  : 'text-navy-600 dark:text-amber-400'
                              }`}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[14px] font-medium">{space.name}</span>
                              <span
                                className={`block text-[12px] ${
                                  space.id === navigation.currentSpaceId
                                    ? 'text-amber-600/75 dark:text-amber-300/75'
                                    : 'text-faint'
                                }`}
                              >
                                {space.project_count} {space.project_count === 1 ? 'project' : 'projects'}
                              </span>
                            </span>
                            {space.id === navigation.currentSpaceId && (
                              <Icon name="check" size={16} className="shrink-0" />
                            )}
                          </button>
                        ))
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={openCreateSpace}
                      className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-left text-[13px] font-medium text-navy-600 hover:bg-[var(--surface-sunken)] dark:text-navy-200"
                    >
                      <Icon name="plus" size={15} />
                      Create space
                    </button>
                    <Link
                      to="/general/spaces"
                      onClick={() => {
                        setSpaceOpen(false)
                        onNavigate?.()
                      }}
                      className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-[13px] font-medium text-muted hover:bg-[var(--surface-sunken)] hover:text-ink"
                    >
                      <Icon name="arrowRight" size={15} />
                      View all spaces
                    </Link>
                  </div>
                )}
              </div>

            </div>
          )}

          {groups.map((group) => (
            <div key={group.title}>
              {!collapsed && <GroupLabel>{group.title}</GroupLabel>}
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <Fragment key={item.label}>
                    <StaticRow
                      item={item}
                      collapsed={collapsed}
                      unread={unread}
                      onNavigate={onNavigate}
                      hintHandlers={hintHandlers}
                    />
                    {workplace === 'general' && item.label === 'Messages' && navigation.currentSpace && (
                      <ArchiveRow
                        spaceId={navigation.currentSpace.id}
                        collapsed={collapsed}
                        onNavigate={onNavigate}
                        hintHandlers={hintHandlers}
                      />
                    )}
                  </Fragment>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <NewSpaceDialog
        open={newSpaceOpen}
        onClose={() => setNewSpaceOpen(false)}
        onCreated={navigation.reload}
      />

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

function GroupLabel({ children }: { children: string }) {
  return (
    <p className="px-3 pb-1.5 text-[12px] font-medium tracking-wide text-faint uppercase">
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
          className={`${ROW} h-10 ${collapsed ? 'justify-center' : 'gap-3 px-3'} cursor-not-allowed text-faint`}
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
        end={item.to.split('/').filter(Boolean).length < 2}
        onClick={onNavigate}
        aria-label={collapsed ? label : undefined}
        {...hintHandlers(item.label)}
        className={({ isActive }) =>
          `${ROW} h-10 ${collapsed ? 'justify-center' : 'gap-3 px-3'} ${
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

function ArchiveRow({
  spaceId,
  collapsed,
  onNavigate,
  hintHandlers,
}: {
  spaceId: string
  collapsed: boolean
  onNavigate?: () => void
  hintHandlers: (text: string) => Record<string, unknown>
}) {
  return (
    <li>
      <NavLink
        to={`/general/spaces/${spaceId}/archive`}
        onClick={onNavigate}
        aria-label={collapsed ? 'Archive' : undefined}
        {...hintHandlers('Archive')}
        className={({ isActive }) =>
          `${ROW} h-10 ${collapsed ? 'justify-center' : 'gap-3 px-3'} ${
            isActive
              ? 'surface-sunken font-semibold text-ink'
              : 'text-muted hover:bg-[var(--surface-sunken)] hover:text-ink'
          }`
        }
      >
        <Icon name="archive" size={18} />
        {!collapsed && <span>Archive</span>}
      </NavLink>
    </li>
  )
}
