/**
 * Filling in the two things a drafted task arrives without: a date and a
 * holder. Suggestions only. The draft modal shows them in editable fields.
 */

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/**
 * Dates spread between now and the deadline, in list order, each task's share
 * of the time following its share of the weight. So a heavy task gets more
 * days than a light one, and the last task lands on the deadline day.
 *
 * Returns local `YYYY-MM-DD` strings, or empty strings when there is no
 * usable window (no deadline, or one already past).
 */
export function spreadDueDates(weights: number[], from: Date, deadline: Date | null): string[] {
  if (!deadline || deadline.getTime() <= from.getTime() || weights.length === 0) {
    return weights.map(() => '')
  }
  const span = deadline.getTime() - from.getTime()
  const total = weights.reduce((n, w) => n + Math.max(1, w), 0)
  let done = 0
  return weights.map((w) => {
    done += Math.max(1, w)
    return ymd(new Date(from.getTime() + (span * done) / total))
  })
}

/** A `YYYY-MM-DD` day as the ISO time of 11:59 pm that day, local time. */
export function endOfDay(day: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  return new Date(`${day}T23:59`).toISOString()
}

/**
 * Hand tasks out so everyone ends up carrying about the same weight: heaviest
 * task first, each to whoever holds the least so far, counting what they
 * already hold on the board. Ties go to the earlier member, so it is stable.
 */
export function shareOut(
  weights: number[],
  members: { id: string; held: number }[],
): (string | null)[] {
  if (members.length === 0) return weights.map(() => null)
  const load = new Map(members.map((m) => [m.id, m.held]))
  const out: (string | null)[] = weights.map(() => null)
  const order = weights.map((w, i) => ({ w, i })).sort((a, b) => b.w - a.w || a.i - b.i)
  for (const { w, i } of order) {
    let best = members[0].id
    for (const m of members) if ((load.get(m.id) ?? 0) < (load.get(best) ?? 0)) best = m.id
    out[i] = best
    load.set(best, (load.get(best) ?? 0) + w)
  }
  return out
}
