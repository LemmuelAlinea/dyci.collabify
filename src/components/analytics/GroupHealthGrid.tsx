import { useState } from 'react'
import { HeatGrid } from '../charts/HeatGrid'
import type { HeatRow } from '../charts/HeatGrid'
import { daysBetween, gini, healthTone } from '../../lib/analyticsMath'
import type { AnalyticsData } from '../../pages/app/analytics/useAnalytics'

const COLUMNS = ['Done vs time', 'Overdue', 'Uneven split', 'Last activity', 'Hand-in', 'Returned']

/** One row per group board. Every cell prints its figure; the colour only ranks it. */
export function GroupHealthGrid({ data, today }: { data: AnalyticsData; today: string }) {
  const [now] = useState(() => Date.now())
  const lastDay = new Map<string, string>()
  for (const a of data.shownActivity) {
    const prev = lastDay.get(a.board_id)
    if (!prev || a.day > prev) lastDay.set(a.board_id, a.day)
  }
  const cycles = new Map(data.shownCycles.map((c) => [c.board_id, c]))

  const rows: HeatRow[] = data.shownBurns
    .filter((b) => b.group_id)
    .map((b) => {
      const elapsed =
        b.days_active === null || b.days_left === null
          ? null
          : b.days_left < 0
            ? 100
            : (b.days_active / (b.days_active + b.days_left)) * 100
      const pace = elapsed === null ? null : Math.round(Number(b.done_pct) - elapsed)
      const overdue = data.shownTasks.filter(
        (t) => t.board_id === b.board_id && t.status !== 'done' && t.due_at && new Date(t.due_at).getTime() < now,
      ).length
      const g = gini(data.shownMembers.filter((m) => m.board_id === b.board_id).map((m) => Number(m.held_pct)))
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
          {
            value: pace === null ? 'Not started' : `${Math.round(Number(b.done_pct))}% · ${pace >= 0 ? '+' : ''}${pace}`,
            tone: healthTone('pace', pace),
            title: 'Per cent done, and points ahead of or behind the time used',
          },
          { value: overdue, tone: healthTone('overdue', overdue) },
          { value: g.toFixed(2), tone: healthTone('gini', g), title: '0 is an even split, 1 is one person holding everything' },
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
