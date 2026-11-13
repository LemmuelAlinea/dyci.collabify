import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon, Spinner } from '../../../../components/ui/Icon'

/** The frame every band on the admin's Home shares. */
export function Band({
  name,
  eyebrow,
  title,
  link,
  flush = false,
  className = '',
  children,
}: {
  /** `data-home-band`, for tests. */
  name: string
  eyebrow: string
  title: string
  link?: { to: string; label: string }
  /** Edge-to-edge body, for a list whose rows carry their own padding. */
  flush?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <section
      data-home-band={name}
      aria-label={title}
      className={`surface flex flex-col overflow-hidden rounded-panel border border-line ${className}`}
    >
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-line bg-[var(--surface-sunken)] px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="mt-1">{title}</h2>
        </div>
        {link && (
          <Link
            to={link.to}
            className="inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink"
          >
            {link.label}
            <Icon name="arrowRight" size={14} />
          </Link>
        )}
      </header>
      <div className={flush ? 'flex-1' : 'flex-1 p-4 sm:p-5'}>{children}</div>
    </section>
  )
}

export function BandLoading({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-3 py-2 text-[13px] text-muted">
      <Spinner size={16} />
      {children}
    </p>
  )
}
