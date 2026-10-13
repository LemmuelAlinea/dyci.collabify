import { addDays, mondayOf } from '../../lib/analyticsMath'
import { shortDay } from './format'

const LEVELS = [
  'surface-sunken',
  'bg-navy-600/20 dark:bg-navy-300/20',
  'bg-navy-600/40 dark:bg-navy-300/40',
  'bg-navy-600/70 dark:bg-navy-300/70',
  'bg-navy-600 dark:bg-navy-300',
]
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Weeks across, weekdays down. Cramming shows as a dark column before a deadline. */
export function CalendarHeat({
  counts,
  from,
  to,
  title,
}: {
  counts: Map<string, number>
  from: string
  to: string
  title: string
}) {
  const weeks: string[] = []
  for (let w = mondayOf(from); w <= to; w = addDays(w, 7)) weeks.push(w)
  const peak = Math.max(0, ...counts.values())
  const level = (n: number) => (n === 0 || peak === 0 ? 0 : Math.min(4, Math.ceil((n / peak) * 4)))
  let busiest: [string, number] | null = null
  for (const [d, n] of counts) if (!busiest || n > busiest[1]) busiest = [d, n]
  const label = busiest
    ? `${title}. Busiest day ${shortDay(busiest[0])} with ${busiest[1]} actions.`
    : `${title}. No activity yet.`

  return (
    <figure className="overflow-x-auto">
      <div role="img" aria-label={label} className="inline-grid grid-flow-col gap-[3px]" style={{ gridTemplateRows: 'repeat(7, 12px)' }}>
        {WEEKDAYS.map((d) => (
          <span key={d} className="pr-1.5 font-mono text-[9px] leading-[12px] text-faint">{d}</span>
        ))}
        {weeks.flatMap((w) =>
          WEEKDAYS.map((_, i) => {
            const day = addDays(w, i)
            const n = day < from || day > to ? 0 : (counts.get(day) ?? 0)
            return <span key={day} title={`${shortDay(day)}: ${n}`} className={`h-3 w-3 rounded-[3px] ${LEVELS[level(n)]}`} />
          }),
        )}
      </div>
      {/* sr-only on a table is ignored: tables size to their rows. */}
      <div className="sr-only">
      <table>
        <caption>{title}</caption>
        <thead><tr><th>Day</th><th>Actions</th></tr></thead>
        <tbody>
          {[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([d, n]) => (
            <tr key={d}><td>{d}</td><td>{n}</td></tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  )
}
