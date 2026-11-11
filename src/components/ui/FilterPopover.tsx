import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { useFocusTrap } from '../../lib/focus'
import { DUR } from '../../lib/motion'
import { pageRect, pageViewport } from '../../lib/zoom'

/**
 * Every filter in the product lives behind this one button.
 *
 * A row of four dropdowns is the widest thing on most of these pages and the
 * least often touched — it pushed the actual content down the screen on a
 * laptop and wrapped into three rows on a phone. Folded into an icon, the page
 * opens on what it is about.
 *
 * The count on the button is what keeps that honest: a filter you cannot see is
 * a filter you forget you set, and an empty list then reads as "there is
 * nothing" rather than "you are hiding it". The number is always visible, the
 * summary line names what is on, and Clear is one press away.
 */
export function FilterPopover({
  active,
  summary,
  onClear,
  children,
  label = 'Filters',
  align,
}: {
  /** How many filters are set. Drives the badge and the clear button. */
  active: number
  /** What is on, in words — shown beside the button so it is never a surprise. */
  summary?: string
  onClear: () => void
  children: ReactNode
  label?: string
  /** Pin a side. Left unset, the panel opens toward whichever side has the room. */
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number; side: 'left' | 'right' } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  // The panel lives in a fixed layer on <body>, not under the button. Hung off
  // the button as an absolute box, it made a short page taller than the screen,
  // so the page scrolled into empty ground below the app. It is as wide as 340px
  // (or 92vw on a phone), opens toward the side with room, and scrolls inside
  // itself when the screen is shorter than the filters.
  function place() {
    if (!button.current) return
    // Page px, so the panel lands under the button at any page zoom.
    const r = pageRect(button.current)
    const vp = pageViewport()
    const w = Math.min(vp.width * 0.92, 340)
    const side = align ?? (r.left + w <= vp.width - 8 ? 'left' : 'right')
    const raw = side === 'left' ? r.left : r.right - w
    const left = Math.min(Math.max(8, raw), vp.width - w - 8)
    const top = r.bottom + 8
    setPos({ top, left, side, maxHeight: Math.max(160, vp.height - top - 8) })
  }

  function toggle() {
    if (!open) place()
    setOpen((v) => !v)
  }

  useLayoutEffect(() => {
    if (!open) return
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // `open` is the caller's intent; `render` is what is on screen, staying true
  // for one transition after `open` goes false so the panel has something to
  // animate from instead of vanishing on the click. Applied during the render
  // body (not an effect) on the way in, so the panel exists in the DOM before
  // useFocusTrap's effect below runs and needs a non-null ref — see Modal.tsx.
  const [render, setRender] = useState(open)
  if (open && !render) setRender(true)
  useEffect(() => {
    if (open) return
    const t = setTimeout(() => setRender(false), DUR.fast)
    return () => clearTimeout(t)
  }, [open])

  // Opening moves focus into the panel and closing hands it back to the icon,
  // so the filters are reachable without a mouse at all. Keyed on `open`, not
  // `render`: the trap should engage and release on the caller's intent, not
  // linger for the extra frame the exit animation keeps the panel mounted for.
  useFocusTrap(panel, open)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (!ref.current?.contains(target) && !panel.current?.contains(target)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative flex min-w-0 items-center gap-3" ref={ref}>
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={active > 0 ? `${label} — ${active} on` : label}
        title={label}
        className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition-[background-color,border-color,color,scale] duration-(--dur-press) active:scale-[0.97] ${
          active > 0 || open
            ? 'border-navy-400 bg-navy-500/10 text-navy-600 dark:text-navy-200'
            : 'surface border-line text-muted hover:border-line-strong hover:text-ink'
        }`}
      >
        <Icon name="filter" size={18} />
        {active > 0 && (
          <span className="absolute -top-1.5 -right-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-amber-400 px-1 font-mono text-[12px] font-bold text-navy-900">
            {active}
          </span>
        )}
      </button>

      {active > 0 && (
        <>
          <p className="min-w-0 truncate text-[12px] text-muted">{summary}</p>
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 text-[12px] font-medium text-navy-600 hover:underline dark:text-navy-200"
          >
            Clear
          </button>
        </>
      )}

      {render && createPortal(
        <div
          ref={panel}
          role="dialog"
          aria-label={label}
          // Dismissed but still mounted for the exit transition: `inert` pulls
          // it out of tab order and the accessibility tree so it stops being a
          // stop for a panel the user just closed. Drops the instant `open`
          // flips back true, so a genuinely open panel is never inert.
          inert={!open}
          data-state={open ? 'open' : 'closed'}
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, maxHeight: pos?.maxHeight }}
          className={`app-ui motion-overlay surface fixed z-[70] w-[min((92vw/var(--zoom,1)),340px)] space-y-3 overflow-y-auto overscroll-contain rounded-2xl border border-line p-4 shadow-lift ${
            pos?.side === 'right' ? 'origin-top-right' : 'origin-top-left'
          }`}
        >
          {children}
          <div className="flex items-center justify-between border-t border-line pt-3">
            <button
              type="button"
              onClick={onClear}
              disabled={active === 0}
              className="text-[12px] font-medium text-muted hover:text-ink disabled:opacity-45"
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[12px] font-medium text-navy-600 hover:underline dark:text-navy-200"
            >
              Done
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

/** A labelled row inside the panel. The label is what the icon hides. */
export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[12px] font-medium text-muted">{label}</span>
      {children}
    </label>
  )
}

/** The search box, which is a filter like any other and lives in here too. */
export function FilterSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (next: string) => void
  placeholder: string
}) {
  return (
    <div className="relative">
      <Icon
        name="search"
        size={15}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-xl border border-[var(--control-line)] bg-[var(--surface)] pr-3 pl-9 text-[13px] text-ink transition-[border-color,box-shadow] duration-200 placeholder:text-[var(--ink-faint)] hover:border-[var(--line-strong)] focus:border-navy-400 focus:ring-4 focus:ring-navy-500/12"
      />
    </div>
  )
}
