import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { useFocusTrap } from '../../lib/focus'

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

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open])

  // Tab used to walk out of the dialog and into the page behind it, which a
  // mouse never reveals because the backdrop hides it.
  useFocusTrap(panel, open, { autoFocus: !focusField })

  useEffect(() => {
    if (!open || !focusField) return
    const field = panel.current?.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])',
    )
    // Falls back to the panel so focus is never left on the page behind.
    ;(field ?? panel.current)?.focus({ preventScroll: true })
  }, [open, focusField])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-60 flex items-end justify-center p-0 sm:items-center sm:p-6">
      {/* Clickable, but not a tab stop: the header already has a real Close
          button, and Escape closes. A focusable full-screen button here just
          added a control that reads as "Close" before the dialog's own title. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-navy-950/55 backdrop-blur-sm"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`surface relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-panel shadow-lift outline-none sm:rounded-panel ${WIDTHS[size]}`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div className="min-w-0">
            <h2 className="text-[20px]">{title}</h2>
            {description && <p className="mt-1 text-[13.5px] text-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mt-1 -mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
          >
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>

        {footer && (
          <footer className="flex flex-wrap justify-end gap-2.5 border-t border-line px-6 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
