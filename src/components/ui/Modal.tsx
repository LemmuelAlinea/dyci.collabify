import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { useFocusTrap } from '../../lib/focus'
import { DUR } from '../../lib/motion'

type Props = {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /**
   * Open with the first field focused instead of the close button.
   *
   * Opt-in rather than the default: on a dialog whose job is to ask a question
   * — "delete this, are you sure" — landing on a text box would be wrong, and
   * landing on the destructive button would be worse. On a dialog whose job is
   * to be filled in, the first field is the only sensible place to start.
   */
  focusField?: boolean
}

const WIDTHS = {
  sm: 'max-w-[420px]',
  md: 'max-w-[560px]',
  lg: 'max-w-[720px]',
  xl: 'max-w-[960px]',
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  focusField = false,
}: Props) {
  const panel = useRef<HTMLDivElement>(null)

  // Callers pass an inline arrow for onClose, so it is a new function on every
  // parent render. Reading it through a ref keeps it out of the effect's deps —
  // otherwise each keystroke re-ran the effect and its focus() call stole focus
  // back from the field being typed into.
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  // `open` is the caller's intent; `render` is what is on screen. They differ
  // for one transition on the way out, which is the whole reason a dialog can
  // animate closed at all — without this the element is unmounted on the frame
  // the user clicks, and there is nothing left to fade.
  //
  // The open->true edge is applied here, during render, rather than in an
  // effect. Every <Modal> in this app is permanently mounted and toggled by
  // `open`, so on that edge this component is already rendering when `open`
  // flips true — calling setState here makes React redo this render with
  // `render` already true and commit the panel to the DOM in the SAME commit.
  // If this were done in an effect instead (as the close edge below still is),
  // the panel would mount one commit late: the trap and autofocus effects
  // would run first, see `panel.current === null`, bail, and never re-run,
  // because their deps (`ref`, `open`) would not have changed on the following
  // commit. Focus would silently stay on the trigger behind the backdrop.
  const [render, setRender] = useState(open)
  if (open && !render) setRender(true)
  useEffect(() => {
    if (open) return
    const t = setTimeout(() => setRender(false), DUR.base)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Keyed on `render`, not `open`: the dialog is still on screen — fading and
  // shrinking out — for one transition after `open` goes false, and the page
  // behind it should not be scrollable while it is still visibly there.
  useEffect(() => {
    if (!render) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [render])

  // Tab used to walk out of the dialog and into the page behind it, which a
  // mouse never reveals because the backdrop hides it. Keyed on `open`, not
  // `render`: the trap should engage and release on the caller's intent, not
  // on the extra frame the exit animation keeps the element mounted for —
  // otherwise Tab would still be caught inside a dialog the user just closed.
  useFocusTrap(panel, open, { autoFocus: !focusField })

  useEffect(() => {
    if (!open || !focusField) return
    const field = panel.current?.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])',
    )
    // Falls back to the panel so focus is never left on the page behind.
    ;(field ?? panel.current)?.focus({ preventScroll: true })
  }, [open, focusField])

  if (!render) return null

  return (
    // `render` staying true after `open` goes false is what lets the dialog fade
    // out instead of vanishing on the click — but for that one transition the
    // node is still in the DOM, still focusable, and still announced as an open
    // dialog. useFocusTrap has already released by then (it's keyed on `open`),
    // so nothing is stopping Tab from walking back into a dialog the user just
    // dismissed. `inert` is the one attribute that pulls the whole exit-only
    // window out of tab order and the accessibility tree in one shot — it drops
    // the instant `open` flips back to true, so a genuinely open dialog is never
    // inert.
    <div
      inert={!open}
      className="fixed inset-0 z-60 flex items-end justify-center p-0 sm:items-center sm:p-6"
    >
      {/* Clickable, but not a tab stop: the header already has a real Close
          button, and Escape closes. A focusable full-screen button here just
          added a control that reads as "Close" before the dialog's own title. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        data-state={open ? 'open' : 'closed'}
        className="motion-scrim absolute inset-0 bg-navy-950/55 backdrop-blur-sm"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-state={open ? 'open' : 'closed'}
        className={`motion-dialog surface relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-panel shadow-lift outline-none sm:rounded-panel ${WIDTHS[size]}`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div className="min-w-0">
            <h2 className="">{title}</h2>
            {description && <p className="mt-1 text-[13px] text-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mt-1 -mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-full text-faint transition-[background-color,color,scale] duration-(--dur-press) hover:bg-[var(--surface-sunken)] hover:text-ink active:scale-[0.97]"
          >
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>

        {footer && (
          <footer className="flex flex-wrap justify-end gap-3 border-t border-line px-6 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
