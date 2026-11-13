import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Reveal } from '../../../../components/motion/Reveal'
import { Icon } from '../../../../components/ui/Icon'

/** One titled card on an analytics view. */
export function Section({
  title,
  subtitle,
  children,
  className = '',
  id,
  collapsible = false,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  className?: string
  /** A "See why" target when nothing finer inside it matches. */
  id?: string
  /** The title folds the card's body away. It starts open. */
  collapsible?: boolean
}) {
  const [open, setOpen] = useState(true)
  const bodyId = useId()
  const shut = collapsible && !open

  return (
    <Reveal as="section" id={id} className={`card min-w-0 space-y-4 p-4 shadow-card sm:p-5 ${className}`}>
      <header>
        <h3 className="text-ink">
          {collapsible ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls={bodyId}
              className="group -ml-1 flex items-center gap-2 rounded-lg px-1 text-left"
            >
              <Icon
                name="chevronDown"
                size={16}
                className={`shrink-0 text-faint transition-transform group-hover:text-ink motion-reduce:transition-none ${open ? '' : '-rotate-90'}`}
              />
              {title}
            </button>
          ) : (
            title
          )}
        </h3>
        {subtitle && (
          <p className={`mt-1 max-w-[66ch] text-[13px] text-muted ${collapsible ? 'pl-6' : ''}`}>{subtitle}</p>
        )}
      </header>
      {collapsible ? (
        <div id={bodyId} hidden={shut}>
          {children}
        </div>
      ) : (
        children
      )}
    </Reveal>
  )
}
