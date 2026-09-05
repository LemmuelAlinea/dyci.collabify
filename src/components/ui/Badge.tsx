import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

/**
 * A count or a status, said once.
 *
 * Ninety-odd places were each spelling out a pill from `rounded-full` plus a
 * size plus a background, which is how four different paddings and three
 * different text sizes ended up live at the same time. Tones map onto colours
 * that already exist — nothing new is introduced here. `success`, `warning`
 * and `danger` are the same `-500/15` and `-400/18` mixes the status pills
 * across classes, groups and admin tables already used, not the paler
 * `-50`/`-800` pairing `Alert` and `Toast` use for a banner.
 */
const TONES: Record<BadgeTone, string> = {
  neutral: 'surface-sunken text-muted',
  accent: 'bg-amber-400 text-navy-900',
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  warning: 'bg-amber-400/18 text-amber-700 dark:text-amber-300',
  danger: 'bg-red-500/15 text-red-700 dark:text-red-300',
}

export function Badge({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: BadgeTone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={`inline-flex min-w-5 items-center justify-center rounded-full px-2 py-0.5 font-mono text-[11.5px] font-semibold ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  )
}
