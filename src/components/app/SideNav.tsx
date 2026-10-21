import { Fragment, useEffect, useState } from 'react'
import type { FocusEvent, MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink, matchPath, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { useAdmission } from '../../hooks/useAdmission'
import { useUnreadTotal } from '../../hooks/useConversations'
import { usePendingInvitations } from '../../hooks/usePendingInvitations'
import { membershipOf } from '../../lib/access'
import { paths } from '../../lib/paths'
import { Logo, LogoMark } from '../brand/Logo'
import { Icon } from '../ui/Icon'
import { navFor } from './nav'
import type { NavGroup, NavItem } from './nav'
import { PlacePicker } from './PlacePicker'
import type { PlaceList } from './PlacePicker'
import { PROJECT_CAP, classRows, spaceAndClassRows, workSpaceRows } from './spaceRows'
import type { LiveRow } from './spaceRows'

type Hint = { text: string; top: number }

// No font-size here on purpose: each kind of row sets its own, and two
// arbitrary text-[] utilities on one element resolve by stylesheet order.
const ROW = 'relative flex w-full items-center rounded-lg transition-colors'
const ACTIVE = 'surface-sunken font-semibold text-ink'
const IDLE = 'font-medium text-muted hover:bg-[var(--surface-sunken)] hover:text-ink'

const FOLDED_KEY = 'collabify:nav-folded'

/** The titles of the sections folded away on this device. */
function readFolded(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

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
  const [folded, setFolded] = useState<string[]>(readFolded)

  function toggleFold(title: string) {
    setFolded((current) => {
      const next = current.includes(title) ? current.filter((t) => t !== title) : [...current, title]
      try {
        localStorage.setItem(FOLDED_KEY, JSON.stringify(next))
      } catch {
        // Private windows can refuse storage; the section still folds for this visit.
      }
      return next
    })
  }

  const unread = useUnreadTotal(profile?.id, 'all')
  const pendingProjects = usePendingInvitations(profile?.id).invitations?.length ?? 0
  // Unread messages plus invitations waiting: everything the Inbox holds for them.
  const pending = pendingProjects + navigation.invitations.length
  const inboxCount = unread + pending
  const admitted = useAdmission(profile?.role === 'student' ? profile.id : undefined)

  useEffect(() => setHint(null), [collapsed, location.pathname, location.search])

  if (!profile) return null

  // Null while it loads counts as admitted, so the rail never flashes empty
  // for a student who has classes.
  const membership = membershipOf(navigation.spaces, navigation.myProjects)
  const groups = navFor(
    profile,
    admitted !== false,
    membership && { ...membership, invited: pending > 0 },
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

  /**
   * The places card's lists, one per kind the rail offers. With
   * `hideWhenEmpty` a kind with no rows is left out — the switch goes with it
   * — and so is every kind while the spaces load, so nothing flashes in and
   * back out.
   */
  function places({ picker = [], withClasses, hideWhenEmpty }: NavGroup): PlaceList[] {
    // Uncapped on the full rail: the card shows the active one, wherever it
    // sorts. The icon rail lists rows, so it keeps the usual three.
    const cap = collapsed ? undefined : Infinity
    const lists: PlaceList[] = picker.map((kind) =>
      kind === 'classes'
        ? { kind, rows: classRows(spaces, cap), more: { to: paths.classes, label: 'All classes' } }
        : {
            kind,
            rows: withClasses ? spaceAndClassRows(spaces, cap) : workSpaceRows(spaces, cap),
            more: { to: paths.spaces, label: 'All spaces' },
          },
    )
    if (!hideWhenEmpty) return lists
    return navigation.spaces === null ? [] : lists.filter((list) => list.rows.length > 0)
  }

  function live({ live: kind }: NavGroup): { rows: LiveRow[]; loading: boolean } {
    if (kind === 'recent') {
      // Class and work projects in one list, most recently changed first.
      const all = [
        ...liveProjects.map((project) => ({
          id: project.id,
          name: project.name,
          to: paths.project(project.id),
          tone: 'work' as const,
          updated_at: project.updated_at,
        })),
        ...(navigation.classProjects ?? []).map((project) => ({
          id: project.id,
          name: project.title,
          to: paths.classProject(project.id),
          tone: 'education' as const,
          updated_at: project.updated_at,
        })),
      ]
      return {
        loading: navigation.myProjects === null || navigation.classProjects === null,
        rows: all.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, PROJECT_CAP),
      }
    }
    return { loading: false, rows: [] }
  }

  return (
    <>
      <nav
        aria-label="Primary"
        className={`flex min-h-0 flex-1 flex-col overflow-y-auto scroll-hidden py-4 ${collapsed ? 'px-2' : 'px-4'}`}
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
                // 12 reads small because `size` is not pixels: Logo multiplies it
                // by 1.85 for the mark's box, and the artwork is wider than it is
                // tall, so 12 draws a mark 17.9 px high against the 18 px the
                // wordmark beside it occupies. The two now match.
                <Logo size={12} tone="brand" showSubtitle={false} />
              )}
            </Link>
          )}

          {showLogo && (
            <hr aria-hidden className={`border-t border-line ${collapsed ? 'mx-2' : 'mx-1'}`} />
          )}

          {groups.map((group) => {
            if (group.picker) {
              const lists = places(group)
              if (lists.length === 0) return null
              // The icon rail has no room for the card: each kind's letters,
              // then its All link, as before.
              if (collapsed) {
                return (
                  <ul key={group.title} className="space-y-0.5">
                    {lists.map((list) => (
                      <Fragment key={list.kind}>
                        {list.rows.map((row) => (
                          <LiveRowLink
                            key={row.id}
                            row={row}
                            collapsed
                            onNavigate={onNavigate}
                            hintHandlers={hintHandlers}
                          />
                        ))}
                        <MoreRow more={list.more} onNavigate={onNavigate} hintHandlers={hintHandlers} />
                      </Fragment>
                    ))}
                  </ul>
                )
              }
              return (
                <PlacePicker
                  key={group.title}
                  title={group.title}
                  lists={lists}
                  currentSpaceId={navigation.currentSpaceId}
                  onNavigate={onNavigate}
                />
              )
            }

            const { rows: allRows, loading } = group.live ? live(group) : { rows: [], loading: false }
            // Hidden while loading too, so a student with no spaces never sees
            // the section flash in and back out.
            if (group.hideWhenEmpty && (loading || allRows.length === 0)) return null

            // Folding is for the full rail; the icon rail has no header to fold
            // with. Folded, the row for the page you are on stays, so the rail
            // still says where you are.
            const isFolded = !collapsed && group.collapsible === true && folded.includes(group.title)
            const here = (to: string, end = false) => matchPath({ path: to, end }, location.pathname) !== null
            const rows = isFolded ? allRows.filter((row) => here(row.to)) : allRows
            const items = isFolded
              ? group.items.filter((item) => item.to && here(item.to, item.end))
              : group.items
            const showMore = !collapsed && group.more && (!isFolded || here(group.more.to, true))
            const listId = `nav-${group.title.toLowerCase().replace(/\s+/g, '-')}`

            return (
              <div key={group.title}>
                {!collapsed && (
                  <GroupHeader
                    title={group.title}
                    fold={
                      group.collapsible
                        ? { open: !isFolded, controls: listId, onToggle: () => toggleFold(group.title) }
                        : undefined
                    }
                  />
                )}
                <ul id={listId} className="space-y-0.5">
                  {rows.map((row) => (
                    <LiveRowLink
                      key={row.id}
                      row={row}
                      collapsed={collapsed}
                      onNavigate={onNavigate}
                      hintHandlers={hintHandlers}
                    />
                  ))}

                  {/* Collapsed there is no header to hang the link on. */}
                  {collapsed && group.more && (
                    <MoreRow
                      more={group.more}
                      onNavigate={onNavigate}
                      hintHandlers={hintHandlers}
                    />
                  )}

                  {showMore && group.more && <MoreLink more={group.more} onNavigate={onNavigate} />}

                  {(rows.length > 0 || showMore) && items.length > 0 && (
                    <li aria-hidden className={`my-2 border-t border-line ${collapsed ? 'mx-2' : 'mx-3'}`} />
                  )}

                  {items.map((item) => (
                    <StaticRow
                      key={item.label}
                      item={item}
                      collapsed={collapsed}
                      unread={inboxCount}
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
              className="depth-ground surface fixed left-[72px] z-[100] -translate-y-1/2 rounded-md border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink shadow-lift"
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
  // A class row carries its section separately; the tooltip names both.
  const label = row.tone === 'education' && row.detail ? `${row.name} · ${row.detail}` : row.name
  return (
    <li>
      <NavLink
        to={row.to}
        onClick={onNavigate}
        aria-label={collapsed ? label : undefined}
        {...hintHandlers(label)}
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
                  ? 'bg-nav-active text-nav-active-ink'
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

/**
 * The link to every class, space or project, under the reader's own rows. It
 * is small, faint and has no icon so it reads as a way further into the list
 * rather than as one more page; the text lines up with the row names above.
 */
function MoreLink({ more, onNavigate }: { more: { to: string; label: string }; onNavigate?: () => void }) {
  return (
    <li>
      <NavLink
        to={more.to}
        end
        onClick={onNavigate}
        className={({ isActive }) =>
          `flex w-fit items-center gap-1 rounded py-1 pl-11 pr-1 text-[12px] transition-colors ${
            isActive ? 'font-semibold text-ink' : 'text-faint hover:text-ink'
          }`
        }
      >
        {more.label}
        <Icon name="arrowRight" size={12} />
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
 */
function GroupHeader({
  title,
  fold,
}: {
  title: string
  /** Set for a section that folds: the header's title becomes its toggle. */
  fold?: { open: boolean; controls: string; onToggle: () => void }
}) {
  const label = 'text-[11px] font-semibold tracking-[0.1em] text-faint uppercase'
  return (
    <div className="flex items-center justify-between gap-2 px-3 pb-2">
      {fold ? (
        <button
          type="button"
          onClick={fold.onToggle}
          aria-expanded={fold.open}
          aria-controls={fold.controls}
          className={`-mx-1 -my-1 flex items-center gap-1 rounded px-1 py-1 transition-colors hover:text-ink ${label}`}
        >
          {title}
          <Icon
            name="chevronDown"
            size={12}
            className={`motion-safe:transition-transform motion-safe:duration-200 ${fold.open ? '' : '-rotate-90'}`}
          />
        </button>
      ) : (
        <p className={label}>{title}</p>
      )}
    </div>
  )
}

function ActiveBar() {
  return (
    <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-nav-marker" />
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
  const label = item.badge === 'inbox' && unread > 0
    ? `${item.label}, ${unread} new`
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
              className={isActive ? 'text-nav-active' : 'text-nav-icon'}
            />
            {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
            {item.badge === 'inbox' && unread > 0 && (
              <span
                aria-hidden
                className={`grid place-items-center rounded-full bg-badge font-mono text-[12px] font-bold text-badge-ink ${
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

