import { useNow } from '../../hooks/useNow'
import { HeatGrid } from '../charts/HeatGrid'
import type { HeatCell, HeatRow } from '../charts/HeatGrid'
import { daysBetween, gini, healthTone, manilaDay } from '../../lib/analyticsMath'
import type { AnalyticsData } from '../../pages/app/analytics/useAnalytics'

const COLUMNS = ['Done vs time', 'Overdue', 'Uneven split', 'Last activity', 'Hand-in', 'Returned']

/** One row per group board. Every cell prints its figure; the colour only ranks it. */
export function GroupHealthGrid({ data, today }: { data: AnalyticsData; today: string }) {
  const now = useNow()
  const lastDay = new Map<string, string>()
  for (const a of data.shownActivity) {
    const prev = lastDay.get(a.board_id)
    if (!prev || a.day > prev) lastDay.set(a.board_id, a.day)
  }
  const cycles = new Map(data.shownCycles.map((c) => [c.board_id, c]))
  // A project starts when its first task was made, read across every board of
  // it, so a group that started late is measured against the same clock.
  const startOf = new Map<string, string>()
  for (const t of data.tasks) {
    const day = manilaDay(t.created_at)
    const prev = startOf.get(t.project_id)
    if (!prev || day < prev) startOf.set(t.project_id, day)
  }

  const rows: HeatRow[] = data.shownBurns
    .filter((b) => b.group_id)
    .map((b) => {
      const overdue = data.shownTasks.filter(
        (t) => t.board_id === b.board_id && t.status !== 'done' && t.due_at && new Date(t.due_at).getTime() < now,
      ).length
      const donePct = Math.round(Number(b.done_pct))
      const start = startOf.get(b.project_id)
      const due = b.project_due_at ? manilaDay(b.project_due_at) : null
      let paceCell: HeatCell
      if (b.result_verdict === 'accepted') {
        paceCell = { value: `${donePct}% · accepted`, tone: 'success', title: 'Accepted, so pace no longer applies' }
      } else if (due === null) {
        paceCell = {
          value: `${donePct}% · no due date`,
          tone: 'pending',
          title: 'Per cent done; the project has no due date to pace against',
        }
      } else if (!start) {
        paceCell = { value: 'No tasks yet', tone: 'pending', title: 'The project has no tasks to pace' }
      } else {
        const elapsed =
          today > due
            ? 100
            : Math.min(100, Math.max(0, (daysBetween(start, today) / Math.max(1, daysBetween(start, due))) * 100))
        const gap = Number(b.done_pct) - elapsed
        const shown = `${gap >= 0 ? '+' : ''}${Math.round(gap)}`
        paceCell = {
          value: b.days_active === null ? `Not started · ${shown}` : `${donePct}% · ${shown}`,
          tone: healthTone('pace', gap),
          title: 'Per cent done, and points ahead of or behind the time elapsed since the project started',
        }
      }
      const held = data.shownMembers.filter((m) => m.board_id === b.board_id).map((m) => Number(m.held_pct))
      const g = gini(held)
      const nobodyHolds = held.every((v) => v === 0)
      const last = lastDay.get(b.board_id)
      const idle = last ? daysBetween(last, today) : null
      const returns = cycles.get(b.board_id)?.returns ?? 0
      const handIn = b.result_verdict === 'accepted'
        ? { value: 'Accepted', tone: 'success' as const }
        : b.submitted_at
          ? { value: 'Handed in', tone: 'success' as const }
          : b.result_verdict === 'returned'
            ? { value: 'Returned', tone: 'warning' as const }
            : { value: 'Open', tone: 'pending' as const }

      return {
        key: b.board_id,
        label: (
          <>
            <span className="block truncate">{b.group_name}</span>
            <span className="block truncate text-[11px] text-faint">{b.project_title}</span>
          </>
        ),
        cells: [
          paceCell,
          { value: overdue, tone: healthTone('overdue', overdue) },
          nobodyHolds
            ? { value: '—', tone: 'pending', title: 'Nobody holds any work yet, so there is no split to measure' }
            : { value: g.toFixed(2), tone: healthTone('gini', g), title: '0 is an even split, 1 is one person holding everything' },
          { value: idle === null ? 'None yet' : idle === 0 ? 'Today' : `${idle}d ago`, tone: healthTone('idle', idle) },
          handIn,
          { value: returns, tone: healthTone('returns', returns) },
        ],
      }
    })

  if (rows.length === 0) {
    return <p className="text-[13px] text-muted">No group boards in view. Individual projects appear under Students.</p>
  }
  return <HeatGrid columns={COLUMNS} rows={rows} caption="Group health" />
}
