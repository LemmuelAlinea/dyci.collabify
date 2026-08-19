import { useMemo } from 'react'
import { EventChip } from './EventChip'
import { dayKey } from '../../lib/types'
import type { CalendarEvent, ClassWeek } from '../../lib/types'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const PER_CELL = 3

/** Monday-first, because a syllabus week starts on one. */
function startOfGrid(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const back = (first.getDay() + 6) % 7
  return new Date(first.getFullYear(), first.getMonth(), first.getDate() - back)
}

function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

/**
 * The month, with the syllabus behind it.
 *
 * The weeks are not events on this grid — they are the grid's spine. Each row
 * carries the syllabus week it falls in, its title, and what that week says is
 * assessed. That is the whole point: a week that names an assessment with
 * nothing set against it is visible as an empty row under a full label.
 */
export function MonthGrid({
  month,
  events,
  weeks,
  onOpen,
}: {
  month: Date
  events: CalendarEvent[]
  weeks: ClassWeek[]
  onOpen: (event: CalendarEvent) => void
}) {
  const gridStart = useMemo(() => startOfGrid(month), [month])

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const e of events) {
      const k = dayKey(e.at)
      const list = map.get(k)
      if (list) list.push(e)
      else map.set(k, [e])
    }
    return map
  }, [events])

  // A row of the grid is seven days; the syllabus week it belongs to is
  // whichever week span contains its Monday.
  const rows = useMemo(() => {
    return Array.from({ length: 6 }, (_, r) => {
      const start = addDays(gridStart, r * 7)
      const end = addDays(start, 6)
      const week =
        weeks.find((w) => {
          if (!w.week_start || !w.week_end) return false
          const ws = new Date(w.week_start)
          const we = new Date(w.week_end)
          return ws <= end && we >= start
        }) ?? null
      return { start, week }
    })
  }, [gridStart, weeks])

  const todayKey = dayKey(new Date())

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px]">
        <div className="grid grid-cols-[132px_repeat(7,minmax(0,1fr))] gap-px">
          <div className="px-2 py-2 text-[11px] text-faint">Syllabus</div>
          {DAY_NAMES.map((d) => (
            <div key={d} className="px-2 py-2 text-center text-[11.5px] font-medium text-muted">
              {d}
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-card border border-line">
          {rows.map(({ start, week }, r) => (
            <div
              key={r}
              className="grid grid-cols-[132px_repeat(7,minmax(0,1fr))] border-b border-line last:border-0"
            >
              {/* The band. Empty when the term has not been dated yet. */}
              <div
                className={`border-r border-line px-2.5 py-2 ${
                  week?.phase === 'current' ? 'bg-amber-400/12' : 'surface-sunken'
                }`}
              >
                {week ? (
                  <>
                    <p className="font-mono text-[10.5px] text-faint">Week {week.week_no}</p>
                    <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug font-medium text-ink">
                      {week.title}
                    </p>
                    {week.assessments && (
                      <p
                        title={week.assessments}
                        className="mt-1 line-clamp-3 text-[10.5px] leading-snug text-amber-700 dark:text-amber-300"
                      >
                        {week.assessments}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[10.5px] text-faint">—</p>
                )}
              </div>

              {Array.from({ length: 7 }, (_, i) => {
                const date = addDays(start, i)
                const key = dayKey(date)
                const list = byDay.get(key) ?? []
                const outside = date.getMonth() !== month.getMonth()
                const today = key === todayKey

                return (
                  <div
                    key={i}
                    className={`min-h-[104px] border-r border-line p-1.5 last:border-r-0 ${
                      outside ? 'bg-[var(--surface-sunken)]/40' : ''
                    }`}
                  >
                    <p
                      className={`mb-1 text-right font-mono text-[11px] ${
                        today
                          ? 'inline-block w-full rounded bg-navy-600 px-1 text-white dark:bg-navy-500'
                          : outside
                            ? 'text-faint'
                            : 'text-muted'
                      }`}
                    >
                      {date.getDate()}
                    </p>
                    <div className="space-y-1">
                      {list.slice(0, PER_CELL).map((e) => (
                        <EventChip
                          key={`${e.kind}:${e.ref_id}`}
                          event={e}
                          onOpen={onOpen}
                          compact
                        />
                      ))}
                      {list.length > PER_CELL && (
                        <p className="px-1 text-[10.5px] text-faint">
                          +{list.length - PER_CELL} more
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
