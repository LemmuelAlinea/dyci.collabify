// src/lib/general/dates.ts
/**
 * Dates as the General workplace shows them.
 *
 * A project's start and end are calendar days (`date` columns), so they are
 * parsed by hand: `new Date('2026-10-01')` is UTC midnight, which is the day
 * before anywhere west of Greenwich. Task due dates are instants.
 */

export function formatDay(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function dateRange(start: string | null, end: string | null) {
  if (start && end) return `${formatDay(start)} – ${formatDay(end)}`
  if (start) return `Starts ${formatDay(start)}`
  if (end) return `Ends ${formatDay(end)}`
  return 'No dates set'
}

export function formatDue(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function isOverdue(iso: string | null, status: string, now = Date.now()) {
  return Boolean(iso) && status !== 'done' && new Date(iso as string).getTime() < now
}

const pad = (n: number) => String(n).padStart(2, '0')

/** For `<input type="datetime-local">`, which has no timezone. */
export function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Null for anything the input would not have produced. A stored value that lost
 * its time half used to throw here, which took the whole form down with it.
 */
export function fromLocalInput(value: string) {
  if (!value) return null
  const [date, time] = value.split('T')
  if (!date || !time) return null
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  if (![y, m, d, hh, mm].every(Number.isFinite)) return null
  return new Date(y, m - 1, d, hh, mm).toISOString()
}
