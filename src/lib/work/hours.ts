/** Minutes as hours with at most one decimal: 840 -> "14 h", 90 -> "1.5 h". */
export function formatHours(minutes: number): string {
  const hours = Math.round((minutes / 60) * 10) / 10
  return `${hours} h`
}

/**
 * Hours typed in the estimate field, as whole minutes. Empty is null (no
 * estimate); anything that is not a number from just above 0 to 1000 is 'invalid'.
 */
export function parseHours(text: string): number | null | 'invalid' {
  const t = text.trim()
  if (t === '') return null
  if (!/^\d+(\.\d+)?$/.test(t)) return 'invalid'
  const hours = Number(t)
  if (hours > 1000) return 'invalid'
  const minutes = Math.round(hours * 60)
  return minutes < 1 ? 'invalid' : minutes
}

const manilaDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Today's Asia/Manila calendar date as YYYY-MM-DD. */
export function manilaToday(now: Date = new Date()): string {
  return manilaDay.format(now)
}

/**
 * This week's Monday and Friday in Asia/Manila. On a Saturday or Sunday it is
 * the coming week, the way the database anchors weekends.
 */
export function workWeek(now: Date = new Date()): { from: string; to: string } {
  const [y, m, d] = manilaToday(now).split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d))
  const dow = day.getUTCDay()
  const forward = dow === 6 ? 2 : dow === 0 ? 1 : -(dow - 1)
  const iso = (offset: number) =>
    new Date(day.getTime() + (forward + offset) * 86_400_000).toISOString().slice(0, 10)
  return { from: iso(0), to: iso(4) }
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-11-24" as "Tue 24 Nov". */
export function formatDayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d))
  return `${DAYS[day.getUTCDay()]} ${d} ${MONTHS[m - 1]}`
}
