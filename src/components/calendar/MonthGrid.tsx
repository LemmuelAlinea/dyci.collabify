import { useMemo, useState } from 'react'
import { EventChip, eventDot } from './EventChip'
import { Icon } from '../ui/Icon'
import { dayKey } from '../../lib/types'
import type { CalendarEvent, ClassWeek } from '../../lib/types'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const PER_CELL = 3
const DOTS_PER_CELL = 3

/**
 * The month switches layout at a container width of 720px: below it the cells
 * are too narrow for a written chip — seven columns of about 50px — so it
 * shows dots and lists the day you tap underneath; above it the syllabus band
 * returns and the cells carry titles.
 *
 * Written out at every use rather than held in a constant. Tailwind reads the
 * source for whole class names, so a concatenated one compiles to nothing at
 * all and the desktop grid quietly keeps the phone layout — which is exactly
 * what happened on the first attempt.
 */

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
 *
 * On a phone none of that fits. The grid used to be 760px wide inside a
 * sideways scroller, which is a month you have to drag to read. Under 720px it
 * becomes what a phone calendar is: seven columns, a number and a few coloured
 * dots, and the day you tap opened underneath — with its syllabus week named
 * there, so the spine is still visible even though the band is not.
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
  const [picked, setPicked] = useState<string | null>(null)

  // Which syllabus week the opened day belongs to, so the band's information is
  // still reachable when the band itself is too wide to draw.
  const pickedRow = picked
    ? rows.find((r) => {
        const start = dayKey(r.start)
        const end = dayKey(addDays(r.start, 6))
        return picked >= start && picked <= end
      })
    : undefined
  const pickedEvents = picked ? (byDay.get(picked) ?? []) : []

  return (
    <div className="@container">
      <div className={`@min-[720px]:min-w-[760px] @min-[720px]:overflow-x-auto`}>
        <div
          className={`grid grid-cols-7 gap-px @min-[720px]:grid-cols-[132px_repeat(7,minmax(0,1fr))]`}
        >
          <div className={`hidden px-2 py-2 text-[11px] text-faint @min-[720px]:block`}>Syllabus</div>
          {DAY_NAMES.map((d) => (
            <div
              key={d}
              className={`px-1 py-1.5 text-center text-[10.5px] font-medium text-muted @min-[720px]:px-2 @min-[720px]:py-2 @min-[720px]:text-[11.5px]`}
            >
              {/* One letter is enough at 50px; the full name returns with the
                  room for it. */}
              <span className={`@min-[720px]:hidden`}>{d[0]}</span>
              <span className={`hidden @min-[720px]:inline`}>{d}</span>
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-card border border-line">
          {rows.map(({ start, week }, r) => (
            <div
              key={r}
              className={`grid grid-cols-7 border-b border-line last:border-0 @min-[720px]:grid-cols-[132px_repeat(7,minmax(0,1fr))]`}
            >
              {/* The band. Empty when the term has not been dated yet. */}
              <div
                className={`hidden border-r border-line px-2.5 py-2 @min-[720px]:block ${
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

                const open = picked === key

                return (
                  <div
                    key={i}
                    className={`min-h-[54px] border-r border-line p-0.5 last:border-r-0 @min-[720px]:min-h-[104px] @min-[720px]:p-1.5 ${
                      outside ? 'bg-[var(--surface-sunken)]/40' : ''
                    } ${open ? 'bg-navy-500/10' : ''}`}
                  >
                    {/* A button under 720px, a plain cell above it: on a phone
                        the day is the control, because the chips it would open
                        are not drawn. */}
                    <button
                      type="button"
                      aria-pressed={open}
                      aria-label={`${date.toLocaleDateString(undefined, {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                      })}${list.length > 0 ? `, ${list.length} dated` : ', nothing dated'}`}
                      onClick={() => setPicked(open ? null : key)}
                      // min-h so the whole cell is the tap target, not just
                      // the number and the dots inside it.
                      className="flex min-h-[46px] w-full flex-col items-center justify-center gap-1 rounded py-1 @min-[720px]:block @min-[720px]:min-h-0 @min-[720px]:py-0 @min-[720px]:pointer-events-none"
                    >
                      <span
                        className={`font-mono text-[11px] @min-[720px]:mb-1 @min-[720px]:block @min-[720px]:w-full @min-[720px]:text-right ${
                          today
                            ? `grid h-5 w-5 place-items-center rounded-full bg-navy-600 text-white @min-[720px]:inline-block @min-[720px]:h-auto @min-[720px]:w-full @min-[720px]:rounded @min-[720px]:px-1 dark:bg-navy-500`
                            : outside
                              ? 'text-faint'
                              : 'text-muted'
                        }`}
                      >
                        {date.getDate()}
                      </span>

                      {/* Dots below 720px. */}
                      <span className={`flex h-1.5 items-center gap-0.5 @min-[720px]:hidden`}>
                        {list.slice(0, DOTS_PER_CELL).map((e) => (
                          <span
                            key={`${e.kind}:${e.ref_id}`}
                            className={`h-1.5 w-1.5 rounded-full ${eventDot(e.kind)} ${
                              e.done && e.kind === 'task_due' ? 'opacity-40' : ''
                            }`}
                          />
                        ))}
                        {list.length > DOTS_PER_CELL && (
                          <span className="font-mono text-[8px] text-faint">+</span>
                        )}
                      </span>
                    </button>

                    {/* Written chips from 720px up. */}
                    <div className={`hidden space-y-1 @min-[720px]:block`}>
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

      {picked && (
        <div className={`mt-3 space-y-2 @min-[720px]:hidden`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-ink">
                {new Date(picked).toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
              {pickedRow?.week && (
                <p className="mt-0.5 text-[11.5px] text-muted">
                  Week {pickedRow.week.week_no} · {pickedRow.week.title}
                </p>
              )}
              {pickedRow?.week?.assessments && (
                <p className="mt-0.5 text-[11.5px] leading-snug text-amber-700 dark:text-amber-300">
                  {pickedRow.week.assessments}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setPicked(null)}
              aria-label="Close the day"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
            >
              <Icon name="x" size={15} />
            </button>
          </div>

          {pickedEvents.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[12.5px] text-muted">
              Nothing is due on this day.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {pickedEvents.map((e) => (
                <li key={`${e.kind}:${e.ref_id}`}>
                  <EventChip event={e} onOpen={onOpen} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
