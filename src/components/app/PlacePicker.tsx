import { useEffect, useState } from 'react'
import { NavLink, matchPath, useLocation } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import type { PlaceKind } from './nav'
import type { LiveRow } from './spaceRows'

export type PlaceList = {
  kind: PlaceKind
  rows: LiveRow[]
  more: { to: string; label: string }
}

const TAB_KEY = 'collabify:nav-place'
const LABEL: Record<PlaceKind, string> = { classes: 'Classes', spaces: 'Spaces' }
const EMPTY: Record<PlaceKind, string> = { classes: 'No classes yet.', spaces: 'No spaces yet.' }

/** The kind last picked on this device, if any. */
function readTab(): PlaceKind | null {
  try {
    const raw = localStorage.getItem(TAB_KEY)
    return raw === 'classes' || raw === 'spaces' ? raw : null
  } catch {
    return null
  }
}

/**
 * The card at the top of the full rail: the reader's classes, their spaces,
 * or both behind a Classes · Spaces switch. Outline, wash, tiles and the
 * switch all take the person's banner colours (`.place-card` and friends in
 * `index.css`), so the card reads as part of the same page as the banners.
 *
 * The switch opens on whichever kind the page in view belongs to, so the row
 * for where you are is never hidden behind it; elsewhere it keeps the last
 * kind picked on this device, then the rail's default (the first list).
 */
export function PlacePicker({
  title,
  lists,
  open,
  controls,
  onToggle,
  currentSpaceId,
  onNavigate,
}: {
  title: string
  lists: PlaceList[]
  /** False while the section is folded away. */
  open: boolean
  controls: string
  onToggle: () => void
  /** The space the rest of the app is working in, marked as the active one. */
  currentSpaceId: string | null
  onNavigate?: () => void
}) {
  const { pathname } = useLocation()
  const [picked, setPicked] = useState<PlaceKind | null>(readTab)

  const routeKind: PlaceKind | null = /^\/classes\/[^/]+/.test(pathname)
    ? 'classes'
    : /^\/spaces\/[^/]+/.test(pathname)
      ? 'spaces'
      : null
  const kinds = lists.map((list) => list.kind).join(',')

  useEffect(() => {
    if (routeKind && kinds.split(',').includes(routeKind)) setPicked(routeKind)
  }, [routeKind, kinds])

  function pick(kind: PlaceKind) {
    setPicked(kind)
    try {
      localStorage.setItem(TAB_KEY, kind)
    } catch {
      // Private windows can refuse storage; the switch still works for this visit.
    }
  }

  const list = lists.find((l) => l.kind === picked) ?? lists[0]
  const here = (to: string) => matchPath({ path: to, end: false }, pathname) !== null
  // Folded, only the row for the page you are on stays, so the rail still says where you are.
  const rows = open ? list.rows : list.rows.filter((row) => here(row.to))

  return (
    <section aria-label={title} className="place-card rounded-2xl p-2.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={controls}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left"
      >
        <Icon name="spark" size={16} className="shrink-0 text-banner-edge" />
        <span className="text-[12px] font-semibold tracking-[0.1em] text-ink uppercase">{title}</span>
        <Icon
          name="chevronDown"
          size={13}
          className={`text-muted motion-safe:transition-transform motion-safe:duration-200 ${open ? '' : '-rotate-90'}`}
        />
      </button>

      <div id={controls}>
        {open && lists.length > 1 && (
          <div role="group" aria-label="Show" className="mt-2.5 grid grid-cols-2 gap-1 rounded-lg surface-sunken p-1">
            {lists.map((l) => (
              <button
                key={l.kind}
                type="button"
                aria-pressed={l.kind === list.kind}
                onClick={() => pick(l.kind)}
                className={`rounded-md py-1.5 text-[13px] transition-colors duration-150 ${
                  l.kind === list.kind
                    ? 'bg-banner-end font-semibold text-banner-end-ink'
                    : 'font-medium text-muted hover:text-ink'
                }`}
              >
                {LABEL[l.kind]}
              </button>
            ))}
          </div>
        )}

        {rows.length > 0 && (
          <ul className="mt-2.5 space-y-1">
            {rows.map((row) => (
              <PlaceRow
                key={row.id}
                row={row}
                current={list.kind === 'spaces' && row.tone === 'work' && row.id === currentSpaceId}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        )}

        {open && rows.length === 0 && (
          <p className="mt-2.5 px-1.5 text-[13px] text-faint">{EMPTY[list.kind]}</p>
        )}

        {open && (
          <NavLink
            to={list.more.to}
            end
            onClick={onNavigate}
            className={({ isActive }) =>
              `mt-2.5 flex items-center justify-between rounded-xl border border-line-strong px-3.5 py-2.5 text-[14px] font-medium text-ink transition-colors ${
                isActive ? 'surface-sunken' : 'hover:bg-[var(--surface-sunken)]'
              }`
            }
          >
            {list.more.label}
            <Icon name="chevronRight" size={16} className="text-muted" />
          </NavLink>
        )}
      </div>
    </section>
  )
}

function PlaceRow({
  row,
  current,
  onNavigate,
}: {
  row: LiveRow
  current: boolean
  onNavigate?: () => void
}) {
  return (
    <li>
      <NavLink
        to={row.to}
        onClick={onNavigate}
        className={({ isActive }) =>
          `flex items-center gap-3 rounded-xl p-2 transition-colors ${
            isActive || current
              ? 'place-row-active'
              : 'border border-transparent hover:bg-[color-mix(in_oklab,var(--banner-edge)_8%,transparent)]'
          }`
        }
      >
        <span
          aria-hidden
          className="place-tile grid h-10 w-10 shrink-0 place-items-center rounded-[10px] font-mono text-[14px] font-bold text-ink"
        >
          {row.name.trim().charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-ink">{row.name}</span>
          {(current || row.detail) && (
            <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
              {current && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-success-500" />}
              <span className="truncate">{current ? 'Active space' : row.detail}</span>
            </span>
          )}
        </span>
      </NavLink>
    </li>
  )
}
