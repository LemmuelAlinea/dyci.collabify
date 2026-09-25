import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import type { IconName } from './Icon'

export type ActionMenuItem = {
  label: string
  icon?: IconName
  onSelect: () => void
  tone?: 'danger'
  disabled?: boolean
  separated?: boolean
}

const WIDTH = 208
const GAP = 4

export function ActionMenu({
  label,
  items,
  align = 'end',
  disabled = false,
  size = 'md',
}: {
  label: string
  items: (ActionMenuItem | false | null | undefined)[]
  align?: 'start' | 'end'
  disabled?: boolean
  size?: 'sm' | 'md'
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const shown = items.filter(Boolean) as ActionMenuItem[]

  // Rendered through a portal so no overflow-hidden list or card can clip it.
  useLayoutEffect(() => {
    if (!open) return
    function place() {
      const t = trigger.current?.getBoundingClientRect()
      if (!t) return
      const h = panel.current?.offsetHeight ?? 0
      const below = t.bottom + GAP
      const top = below + h > window.innerHeight - 8 && t.top - GAP - h > 8 ? t.top - GAP - h : below
      const raw = align === 'end' ? t.right - WIDTH : t.left
      const left = Math.min(Math.max(8, raw), window.innerWidth - WIDTH - 8)
      setPos({ top, left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, align])

  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus()
    function onDown(e: MouseEvent) {
      const target = e.target as Node
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        trigger.current?.focus()
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])]
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = e.key === 'ArrowDown' ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length
        buttons[next]?.focus()
      }
      if (e.key === 'Tab') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  if (shown.length === 0) return null

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className={`grid shrink-0 place-items-center rounded-lg text-ink/70 transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink disabled:opacity-40 dark:text-white/80 dark:hover:text-white ${
          size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'
        } ${open ? 'bg-[var(--surface-sunken)] text-ink dark:text-white' : ''}`}
      >
        <Icon name="dots" size={size === 'sm' ? 15 : 17} strokeWidth={2.4} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            aria-label={label}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: WIDTH }}
            className="app-ui surface fixed z-[70] overflow-hidden rounded-xl border border-line py-1 shadow-lift"
          >
            {shown.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
                className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] disabled:opacity-50 ${
                  item.separated ? 'mt-1 border-t border-line pt-2.5' : ''
                } ${
                  item.tone === 'danger'
                    ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10'
                    : 'text-ink hover:bg-[var(--surface-sunken)]'
                }`}
              >
                {item.icon && <Icon name={item.icon} size={15} className={item.tone === 'danger' ? '' : 'text-muted'} />}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
