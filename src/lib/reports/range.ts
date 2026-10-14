import { addDays, daysBetween, mondayOf } from '../analyticsMath'

/** A run of Manila days, both ends included. */
export type DayRange = { from: string; to: string }

export type RangeChoice = 'thisWeek' | 'lastWeek' | 'last7' | 'last30' | 'custom'

export const RANGE_CHOICES: { value: RangeChoice; label: string }[] = [
  { value: 'thisWeek', label: 'This week' },
  { value: 'lastWeek', label: 'Last week' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'custom', label: 'Choose dates' },
]

const isDay = (v?: string): v is string =>
  !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v

/** `today` is a Manila day. Weeks run Monday to Sunday. */
export function resolveRange(choice: RangeChoice, today: string, custom?: { from?: string; to?: string }): DayRange {
  switch (choice) {
    case 'thisWeek': {
      const m = mondayOf(today)
      return { from: m, to: addDays(m, 6) }
    }
    case 'lastWeek': {
      const m = addDays(mondayOf(today), -7)
      return { from: m, to: addDays(m, 6) }
    }
    case 'last30':
      return { from: addDays(today, -29), to: today }
    case 'custom':
      if (isDay(custom?.from) && isDay(custom?.to)) {
        return custom.from <= custom.to ? { from: custom.from, to: custom.to } : { from: custom.to, to: custom.from }
      }
      return { from: addDays(today, -6), to: today }
    case 'last7':
    default:
      return { from: addDays(today, -6), to: today }
  }
}

export function previousRange(r: DayRange): DayRange {
  const n = daysBetween(r.from, r.to) + 1
  return { from: addDays(r.from, -n), to: addDays(r.from, -1) }
}

const SHORT = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' })
const LONG = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })
const at = (day: string) => new Date(`${day}T00:00:00+08:00`)

export function rangeText(r: DayRange): string {
  if (r.from === r.to) return LONG.format(at(r.from))
  if (r.from.slice(0, 4) === r.to.slice(0, 4)) return `${SHORT.format(at(r.from))} to ${LONG.format(at(r.to))}`
  return `${LONG.format(at(r.from))} to ${LONG.format(at(r.to))}`
}

export function parseRangeChoice(raw: string | null, fallback: RangeChoice): RangeChoice {
  return RANGE_CHOICES.some((c) => c.value === raw) ? (raw as RangeChoice) : fallback
}

/** Which deliverables a compliance report covers, by when they fall due. */
export type DueChoice = 'all' | 'term' | 'custom'

export const DUE_CHOICES: { value: DueChoice; label: string }[] = [
  { value: 'all', label: 'Every date' },
  { value: 'term', label: 'This term' },
  { value: 'custom', label: 'Choose dates' },
]

export function parseDueChoice(raw: string | null): DueChoice {
  return raw === 'term' || raw === 'custom' ? raw : 'all'
}

/** Null means every date: no window, or a term or choice that is not complete. */
export function resolveDueWindow(
  choice: DueChoice,
  term: { start: string | null; end: string | null },
  custom: { from?: string; to?: string },
): DayRange | null {
  if (choice === 'term') {
    if (!isDay(term.start ?? undefined) || !isDay(term.end ?? undefined)) return null
    return term.start! <= term.end! ? { from: term.start!, to: term.end! } : { from: term.end!, to: term.start! }
  }
  if (choice === 'custom' && isDay(custom.from) && isDay(custom.to)) {
    return custom.from <= custom.to ? { from: custom.from, to: custom.to } : { from: custom.to, to: custom.from }
  }
  return null
}
