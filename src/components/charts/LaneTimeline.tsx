import type { ReactNode } from 'react'
import { daysBetween } from '../../lib/analyticsMath'
import type { MilestoneState } from '../../lib/analyticsMath'
import { shortDay } from './format'

export type LaneMark = { key: string; day: string; label: string; state: MilestoneState }
export type LaneBar = { from: string; to: string; tone: 'done' | 'open' | 'late' }
export type Lane = { key: string; label: string; sub?: string; bar?: LaneBar; marks: LaneMark[] }

const MARK: Record<MilestoneState, string> = {
  met: 'bg-success-500 border-success-600',
  late: 'bg-danger-500 border-danger-600',
  upcoming: 'surface border-navy-500 dark:border-navy-300',
  no_tasks: 'bg-pending-soft border-line-strong',
}
const MARK_WORD: Record<MilestoneState, string> = {
  met: 'met',
  late: 'late',
  upcoming: 'upcoming',
  no_tasks: 'no tasks tagged',
}
const BAR: Record<LaneBar['tone'], string> = {
  done: 'bg-success-500/60',
  open: 'bg-navy-400/50 dark:bg-navy-300/40',
  late: 'bg-danger-500/60',
}

/** One row per group or task across a shared date axis, with today marked. */
export function LaneTimeline({
  lanes,
  from,
  to,
  today,
  title,
}: {
  lanes: Lane[]
  from: string
  to: string
  today: string
  title: string
}) {
  const span = Math.max(1, daysBetween(from, to))
  const pct = (day: string) => `${Math.min(100, Math.max(0, (daysBetween(from, day) / span) * 100))}%`
  const showToday = today >= from && today <= to

  return (
    <figure className="space-y-1.5" aria-label={title}>
      <div className="flex justify-between pl-[calc(34%_+_12px)] font-mono text-[10px] text-faint sm:pl-[180px]">
        <span>{shortDay(from)}</span>
        <span>{shortDay(to)}</span>
      </div>
      <ul className="space-y-1.5" aria-hidden>
        {lanes.map((l) => (
          <li key={l.key} className="flex items-center gap-3">
            <span className="w-[34%] shrink-0 truncate text-[13px] text-ink sm:w-[168px]">
              {l.label}
              {l.sub && <span className="block truncate text-[11px] text-faint">{l.sub}</span>}
            </span>
            <span className="relative h-6 flex-1 rounded-md surface-sunken">
              {showToday && <span className="absolute inset-y-0 w-px bg-amber-400" style={{ left: pct(today) }} />}
              {l.bar && (
                <span
                  className={`absolute top-1/2 h-2 -translate-y-1/2 rounded-full ${BAR[l.bar.tone]}`}
                  style={{ left: pct(l.bar.from), width: `max(4px, calc(${pct(l.bar.to)} - ${pct(l.bar.from)}))` }}
                />
              )}
              {l.marks.map((m) => (
                <span
                  key={m.key}
                  title={`${m.label}, ${shortDay(m.day)}: ${MARK_WORD[m.state]}`}
                  className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border ${MARK[m.state]}`}
                  style={{ left: pct(m.day) }}
                />
              ))}
            </span>
          </li>
        ))}
      </ul>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-[12px] text-muted">
        {(['met', 'late', 'upcoming'] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rotate-45 border ${MARK[s]}`} />
            {MARK_WORD[s][0].toUpperCase() + MARK_WORD[s].slice(1)}
          </span>
        ))}
        <span className="flex items-center gap-1.5"><span className="h-3 w-px bg-amber-400" />Today</span>
      </figcaption>
      {/* sr-only on a table is ignored: tables size to their rows. */}
      <div className="sr-only">
      <table>
        <caption>{title}</caption>
        <thead><tr><th>Row</th><th>Item</th><th>Date</th><th>State</th></tr></thead>
        <tbody>
          {lanes.flatMap((l) => {
            const rows: ReactNode[] = []
            if (l.bar) {
              rows.push(
                <tr key={`${l.key}-span`}>
                  <td>{l.label}</td><td>Span</td><td>{`${l.bar.from} to ${l.bar.to}`}</td><td>{l.bar.tone}</td>
                </tr>,
              )
            }
            for (const m of l.marks) {
              rows.push(
                <tr key={`${l.key}-${m.key}`}>
                  <td>{l.label}</td><td>{m.label}</td><td>{m.day}</td><td>{MARK_WORD[m.state]}</td>
                </tr>,
              )
            }
            if (!l.bar && l.marks.length === 0) {
              rows.push(
                <tr key={`${l.key}-empty`}>
                  <td>{l.label}</td><td>—</td><td></td><td></td>
                </tr>,
              )
            }
            return rows
          })}
        </tbody>
      </table>
      </div>
    </figure>
  )
}
