import type { ReactNode } from 'react'
import { Reveal } from '../../../../components/motion/Reveal'

/** One titled card on an analytics view. */
export function Section({
  title,
  subtitle,
  children,
  className = '',
}: {
  title: string
  subtitle?: string
  children: ReactNode
  className?: string
}) {
  return (
    <Reveal as="section" className={`card min-w-0 space-y-4 p-4 shadow-card sm:p-5 ${className}`}>
      <header>
        <h3 className="text-ink">{title}</h3>
        {subtitle && <p className="mt-1 max-w-[66ch] text-[13px] text-muted">{subtitle}</p>}
      </header>
      {children}
    </Reveal>
  )
}
