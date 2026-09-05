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

/**
 * Mono in this app is spoken for — `src/styles/index.css` reserves the face
 * for numerals and counts, the one register where a fixed digit width earns
 * its keep. A status word like "not ready", "behind", or an account-status
 * label is prose read alongside other prose, not a number read at a glance,
 * so it takes the same sans face and weight as the text around it. `numeric`
 * is the one switch that opts a badge into the other register, and it exists
 * because a first pass put every converted site into mono-bold regardless of
 * which kind of content it held, turning ten status words bold and
 * monospaced along with the three counts that actually wanted it.
 */
export function Badge({
  tone = 'neutral',
  numeric = false,
  children,
  className = '',
}: {
  tone?: BadgeTone
  /** Set only when the content is an actual count — not for a status word. */
  numeric?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={`inline-flex min-w-5 items-center justify-center rounded-full px-2 py-0.5 text-[11.5px] ${numeric ? 'font-mono font-semibold' : ''} ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  )
}
