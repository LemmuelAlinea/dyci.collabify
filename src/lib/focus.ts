import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/**
 * Everything focusable inside a container, in tab order. `:not([inert] *)` and
 * the hidden checks matter because dialogs here keep closed panels mounted.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableIn(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  )
}

/**
 * Hold keyboard focus inside an open overlay, and give it back when it closes.
 *
 * Without this, Tab walks straight out of a dialog and into the page behind it.
 * The page is still there — a sighted mouse user never notices, because the
 * backdrop covers it — so someone on a keyboard ends up typing into a form they
 * cannot see, with no way of knowing the dialog is still open.
 *
 * Restoring focus on close is the other half, and the more commonly missed one.
 * Focus otherwise falls back to `<body>`, and the next Tab starts again from
 * the top of the page rather than from the button that was just pressed.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  { autoFocus = true }: { autoFocus?: boolean } = {},
) {
  const restoreTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    const root = ref.current
    if (!root) return

    restoreTo.current = document.activeElement as HTMLElement | null

    if (autoFocus) {
      // The first real control, not the panel itself: a screen reader announces
      // the dialog from its role either way, and landing on the first field is
      // one keystroke less for everybody.
      const first = focusableIn(root)[0]
      ;(first ?? root).focus({ preventScroll: true })
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = focusableIn(root)
      if (items.length === 0) {
        e.preventDefault()
        root.focus({ preventScroll: true })
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null

      // Focus can start outside the trap when the overlay opens with nothing
      // focusable yet; pull it back rather than letting Tab escape.
      if (!active || !root.contains(active)) {
        e.preventDefault()
        first.focus()
        return
      }
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      const back = restoreTo.current
      // Only if it is still on the page — the trigger is often unmounted by the
      // very action that closed the overlay.
      if (back && document.contains(back)) back.focus({ preventScroll: true })
    }
  }, [ref, open, autoFocus])
}
