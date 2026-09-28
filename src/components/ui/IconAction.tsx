import { useState } from 'react'
import type { FocusEvent, MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { buttonClass } from './Button'
import { Icon, Spinner } from './Icon'
import type { IconName } from './Icon'

type Tip = { x: number; y: number }

/**
 * A square, icon-only button for a row of actions on a page banner. Its name
 * is its accessible name, and shows in a tooltip on hover and keyboard focus.
 * The tooltip is portaled to <body> because banners clip their overflow.
 */
export function IconAction({
  label,
  icon,
  variant = 'onNavy',
  to,
  onClick,
  loading,
  disabled,
}: {
  label: string
  icon: IconName
  /** `danger` is for delete: filled red whatever the person's colours. */
  variant?: 'onNavy' | 'destroy' | 'create' | 'danger'
  /** A link instead of a button. */
  to?: string
  onClick?: () => unknown
  loading?: boolean
  disabled?: boolean
}) {
  const [tip, setTip] = useState<Tip | null>(null)

  function show(event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    setTip({ x: rect.left + rect.width / 2, y: rect.bottom + 6 })
  }
  const hide = () => setTip(null)

  const common = {
    'aria-label': label,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
    className: buttonClass({ variant, size: 'sm', className: '!h-8 !w-8 shrink-0 !gap-0 !rounded-lg !px-0' }),
  }
  const glyph = loading ? <Spinner size={14} /> : <Icon name={icon} size={15} />

  return (
    <>
      {to ? (
        <Link to={to} {...common}>
          {glyph}
        </Link>
      ) : (
        <button
          type="button"
          {...common}
          disabled={disabled || loading}
          onClick={() => {
            hide()
            onClick?.()
          }}
        >
          {glyph}
        </button>
      )}
      {tip &&
        createPortal(
          <div
            role="tooltip"
            style={{ left: tip.x, top: tip.y }}
            className="depth-ground surface pointer-events-none fixed z-[100] -translate-x-1/2 rounded-md border border-line px-2.5 py-1.5 text-[12px] font-medium whitespace-nowrap text-ink shadow-lift"
          >
            {label}
          </div>,
          document.body,
        )}
    </>
  )
}
