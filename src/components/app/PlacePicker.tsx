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
const OPEN_KEY = 'collabify:nav-place-open'
const CLASS_KEY = 'collabify:nav-class'
const LABEL: Record<PlaceKind, string> = { classes: 'Classes', spaces: 'Spaces' }
const EMPTY: Record<PlaceKind, string> = { classes: 'No classes yet.', spaces: 'No spaces yet.' }

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private windows can refuse storage; the choice still holds for this visit.
  }
}

/**
 * The card at the top of the full rail: the one class or space the reader is
 * in, and the way to all of them. Outline, wash, tile and switch take the
 * person's banner colours (`.place-card` and friends in `index.css`).
 *
 * Only ever one row. For spaces it is the space the app is working in
 * (`currentSpaceId`); for classes, the class on screen, else the last one
 * opened on this device, else the first. A card with both kinds folds a
 * Classes · Spaces switch behind its header; the switch opens on the kind the
 * page in view belongs to, else the last kind picked here, else the rail's
 * default (the first list).
 */
export function PlacePicker({
  title,
  lists,
  currentSpaceId,
  onNavigate,
}: {
  title: string
  lists: PlaceList[]
  /** The space the rest of the app is working in. */
  currentSpaceId: string | null
  onNavigate?: () => void
}) {
  const { pathname } = useLocation()
  const [picked, setPicked] = useState<PlaceKind | null>(() => {
    const raw = read(TAB_KEY)
    return raw === 'classes' || raw === 'spaces' ? raw : null
  })
  const [open, setOpen] = useState(() => read(OPEN_KEY) === 'true')
  const [lastClass, setLastClass] = useState(() => read(CLASS_KEY))

  const here = (to: string) => matchPath({ path: to, end: false }, pathname) !== null
  const routeKind: PlaceKind | null = /^\/classes\/[^/]+/.test(pathname)
    ? 'classes'
    : /^\/spaces\/[^/]+/.test(pathname)
      ? 'spaces'
      : null
  const kinds = lists.map((l) => l.kind).join(',')

  useEffect(() => {
    if (routeKind && kinds.split(',').includes(routeKind)) setPicked(routeKind)
  }, [routeKind, kinds])

  // Opening a class makes it the one the card keeps showing afterwards.
  const openedClass = lists
    .flatMap((l) => l.rows)
    .find((row) => row.tone === 'education' && matchPath({ path: row.to, end: false }, pathname))?.id
  useEffect(() => {
    if (!openedClass) return
    setLastClass(openedClass)
    write(CLASS_KEY, openedClass)
  }, [openedClass])

  const list = lists.find((l) => l.kind === picked) ?? lists[0]
  const row =
    list.rows.find((r) => here(r.to)) ??
    list.rows.find((r) => (r.tone === 'work' ? r.id === currentSpaceId : r.id === lastClass)) ??
    list.rows[0]
  const both = lists.length > 1

  function pick(kind: PlaceKind) {
    setPicked(kind)
    write(TAB_KEY, kind)
  }

  function toggle() {
    setOpen((was) => {
      write(OPEN_KEY, String(!was))
      return !was
    })
  }

  const heading = (
    <>
      <Icon name="spark" size={16} className="shrink-0 text-banner-edge" />
      <span className="text-[12px] font-semibold tracking-[0.1em] text-ink uppercase">{title}</span>
    </>
  )

  return (
    <section aria-label={title} className="place-card rounded-2xl p-2.5">
      {/* Only a card with two kinds has anything to unfold: the switch. */}
      {both ? (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls="nav-place-switch"
          className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left"
        >
          {heading}
          <Icon
            name="chevronDown"
            size={13}
            className={`text-muted motion-safe:transition-transform motion-safe:duration-200 ${open ? '' : '-rotate-90'}`}
          />
        </button>
      ) : (
        <div className="flex items-center gap-2 px-1.5 py-1">{heading}</div>
      )}

      {both && open && (
        <div
          id="nav-place-switch"
          role="group"
          aria-label="Show"
          className="mt-2.5 grid grid-cols-2 gap-1 rounded-lg surface-sunken p-1"
        >
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

      {row ? (
        <NavLink
          to={row.to}
          onClick={onNavigate}
          className="place-row-active mt-2.5 flex items-center gap-3 rounded-xl p-2"
        >
          <span
            aria-hidden
            className="place-tile grid h-10 w-10 shrink-0 place-items-center rounded-[10px] font-mono text-[14px] font-bold text-ink"
          >
            {row.name.trim().charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold text-ink">{row.name}</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-presence" />
              <span className="truncate">
                {row.tone === 'education'
                  ? `Active class${row.detail && row.detail !== 'Class' ? ` · ${row.detail}` : ''}`
                  : 'Active space'}
              </span>
            </span>
          </span>
        </NavLink>
      ) : (
        <p className="mt-2.5 px-1.5 text-[13px] text-faint">{EMPTY[list.kind]}</p>
      )}

      <NavLink
        to={list.more.to}
        end
        onClick={onNavigate}
        className={({ isActive }) =>
          `mt-2 flex items-center justify-between rounded-lg border border-line-strong px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:text-ink ${
            isActive ? 'surface-sunken text-ink' : 'hover:bg-[var(--surface-sunken)]'
          }`
        }
      >
        {list.more.label}
        <Icon name="chevronRight" size={14} />
      </NavLink>
    </section>
  )
}
