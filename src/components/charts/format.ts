import type { Tone } from '../../lib/analyticsMath'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 'YYYY-MM-DD' as '7 Oct'. */
export function shortDay(day: string): string {
  const [, m, d] = day.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}`
}

/** A tinted cell or chip for each tone, readable in light and dark. */
export const TONE_CELL: Record<Tone, string> = {
  success: 'bg-success-500/15 text-success-700 dark:text-success-300',
  warning: 'bg-warning-400/20 text-warning-700 dark:text-warning-300',
  danger: 'bg-danger-500/15 text-danger-700 dark:text-danger-300',
  pending: 'bg-pending-soft text-pending-ink',
}
