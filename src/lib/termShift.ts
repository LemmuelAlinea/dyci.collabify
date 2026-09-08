/**
 * The date arithmetic behind moving a term's weeks.
 *
 * Kept out of the components so vitest can hold it. The whole feature turns on
 * one subtraction being right — get the sign or the timezone wrong and a
 * professor answering a typhoon moves their class the wrong way, or by a day.
 *
 * Every date here is a plain `YYYY-MM-DD` string, which is what a Postgres
 * `date` column and an `<input type="date">` both speak. None of it goes near
 * a timestamp.
 */

/**
 * Parse `YYYY-MM-DD` as a local day.
 *
 * `new Date('2026-07-20')` is parsed as **UTC midnight**, which is the previous
 * day anywhere west of Greenwich. Harmless in Manila and wrong in Manila's
 * documentation, so the parts are put together by hand. This is the same fix
 * `ClassSyllabusTab` already carried privately; both read it from here now.
 */
export function localDay(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/** Back to `YYYY-MM-DD`, for an input's value or a database write. */
export function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Whole days from `from` to `to`. Positive means later.
 *
 * Both are local days at midnight, so no daylight-saving hour can round this
 * to the wrong integer — which it could if these were timestamps.
 */
export function shiftDays(from: string, to: string): number {
  return Math.round((localDay(to).getTime() - localDay(from).getTime()) / 86_400_000)
}

/** `addDays('2026-07-20', 7)` → `'2026-07-27'`. */
export function addDays(day: string, days: number): string {
  const d = localDay(day)
  d.setDate(d.getDate() + days)
  return isoDay(d)
}

/**
 * What the professor is about to do, in a sentence they can check.
 *
 * The count is the thing worth saying out loud: "moves this and 12 later
 * weeks" is the difference between fixing a typhoon and re-dating a term by
 * accident, and it is not obvious from a date picker.
 */
export function describeShift(days: number, weeksAffected: number): string {
  if (days === 0) return 'That is the date it already starts on.'

  const magnitude = Math.abs(days)
  const direction = days > 0 ? 'later' : 'earlier'
  const amount =
    magnitude % 7 === 0
      ? `${magnitude / 7} week${magnitude === 7 ? '' : 's'}`
      : `${magnitude} day${magnitude === 1 ? '' : 's'}`

  const rest = weeksAffected - 1
  const scope =
    rest <= 0
      ? 'Moves this week'
      : `Moves this and ${rest} later week${rest === 1 ? '' : 's'}`

  return `${scope} ${amount} ${direction}.`
}

/**
 * How a recorded shift reads on the week map.
 *
 * Students see this, so it says what happened rather than naming a column.
 */
export function describeRecordedShift(fromWeek: number, days: number): string {
  const magnitude = Math.abs(days)
  const direction = days > 0 ? 'later' : 'earlier'
  const amount =
    magnitude % 7 === 0
      ? `${magnitude / 7} week${magnitude === 7 ? '' : 's'}`
      : `${magnitude} day${magnitude === 1 ? '' : 's'}`
  return `Week ${fromWeek} onwards moved ${amount} ${direction}`
}
