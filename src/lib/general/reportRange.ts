/**
 * Date ranges for General reports.
 *
 * A range is two local calendar days, both inclusive, as `YYYY-MM-DD`. The
 * database takes instants, so `toUtcBounds` turns the pair into
 * `[from 00:00, to + 1 day 00:00)` in the viewer's time zone — the same day a
 * person sees on their wall clock, whatever the server's zone.
 */

export type RangePreset =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'last7'
  | 'last30'
  | 'thisMonth'
  | 'lastMonth'
  | 'projectDuration'
  | 'all'
  | 'custom'
  | 'day'

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'thisWeek', label: 'This week' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'projectDuration', label: 'Project duration' },
  { value: 'all', label: 'All time' },
  { value: 'day', label: 'A single day' },
  { value: 'custom', label: 'Custom range' },
]

export type DayRange = { from: string; to: string }

const pad = (n: number) => String(n).padStart(2, '0')

/** A Date's local calendar day. */
export function dayOf(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parseDay(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = parseDay(value)
  return dayOf(d) === value
}

export function addDays(day: string, n: number) {
  const d = parseDay(day)
  d.setDate(d.getDate() + n)
  return dayOf(d)
}

/** Whole days from `from` to `to`, both counted. */
export function daysIn(range: DayRange) {
  const a = parseDay(range.from)
  const b = parseDay(range.to)
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
    Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000) + 1
}

/** The day a preset means today. Weeks start on Monday. */
export function resolveRange(
  preset: RangePreset,
  now: Date,
  project?: { starts_on: string | null; ends_on: string | null } | null,
  custom?: { from?: string; to?: string },
): DayRange {
  const today = dayOf(now)
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday': {
      const y = addDays(today, -1)
      return { from: y, to: y }
    }
    case 'thisWeek': {
      const back = (now.getDay() + 6) % 7
      return { from: addDays(today, -back), to: today }
    }
    case 'last7':
      return { from: addDays(today, -6), to: today }
    case 'last30':
      return { from: addDays(today, -29), to: today }
    case 'thisMonth':
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case 'lastMonth': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const last = new Date(now.getFullYear(), now.getMonth(), 0)
      return { from: dayOf(first), to: dayOf(last) }
    }
    case 'projectDuration': {
      const from = project?.starts_on && isDay(project.starts_on) ? project.starts_on : addDays(today, -29)
      const end = project?.ends_on && isDay(project.ends_on) ? project.ends_on : today
      return from <= end ? { from, to: end } : { from: end, to: end }
    }
    case 'all':
      return { from: '2000-01-01', to: today }
    case 'day': {
      const d = custom?.from && isDay(custom.from) ? custom.from : today
      return { from: d, to: d }
    }
    case 'custom': {
      const from = custom?.from && isDay(custom.from) ? custom.from : addDays(today, -6)
      const to = custom?.to && isDay(custom.to) ? custom.to : today
      return from <= to ? { from, to } : { from: to, to: from }
    }
  }
}

/** The period of the same length that ends the day before this one starts. */
export function previousPeriod(range: DayRange): DayRange {
  const n = daysIn(range)
  return { from: addDays(range.from, -n), to: addDays(range.from, -1) }
}

/** Minutes a zone is ahead of UTC at an instant. */
function zoneOffset(instant: number, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUtc - instant) / 60_000)
}

/** The instant a local day begins in a zone, as an ISO string. */
export function startOfDayIn(day: string, tz: string) {
  const [y, m, d] = day.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d)
  let instant = guess - zoneOffset(guess, tz) * 60_000
  // Once more at the corrected instant, for a day a clock change falls in.
  instant = guess - zoneOffset(instant, tz) * 60_000
  return new Date(instant).toISOString()
}

export function toUtcBounds(range: DayRange, tz: string) {
  return { from: startOfDayIn(range.from, tz), to: startOfDayIn(addDays(range.to, 1), tz) }
}

export function viewerZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "1–30 Sep 2026", "30 Aug – 5 Sep 2026", "14 Sep 2026". Fixed month names, whatever the locale. */
export function rangeLabel(range: DayRange) {
  const a = parseDay(range.from)
  const b = parseDay(range.to)
  const month = (d: Date) => MONTHS[d.getMonth()]
  if (range.from === range.to) return `${a.getDate()} ${month(a)} ${a.getFullYear()}`
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return `${a.getDate()}–${b.getDate()} ${month(b)} ${b.getFullYear()}`
  }
  if (a.getFullYear() === b.getFullYear()) {
    return `${a.getDate()} ${month(a)} – ${b.getDate()} ${month(b)} ${b.getFullYear()}`
  }
  return `${a.getDate()} ${month(a)} ${a.getFullYear()} – ${b.getDate()} ${month(b)} ${b.getFullYear()}`
}
