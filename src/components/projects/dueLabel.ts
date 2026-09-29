import { calendarDaysUntil, hasPassed } from '../../lib/types'

/**
 * The date, without the day-and-time stamp. Two of these cards fit across a
 * phone, and at 174px "Due in 3 days · Aug 27, 4:17 PM" wraps onto three lines
 * — which is more of the card than the deadline deserves. The stamp is still
 * there from `sm` up, where there is room for it.
 */
export function dueLabelShort(iso: string | null) {
  return dueLabel(iso).split(' · ')[0]
}

export function dueLabel(iso: string | null) {
  if (!iso) return 'No deadline'
  const due = new Date(iso)
  const stamp = due.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  if (hasPassed(iso)) return `Was due ${stamp}`
  const days = calendarDaysUntil(iso)
  if (days <= 0) return `Due today · ${stamp}`
  if (days === 1) return `Due tomorrow · ${stamp}`
  if (days <= 14) return `Due in ${days} days · ${stamp}`
  return `Due ${stamp}`
}
