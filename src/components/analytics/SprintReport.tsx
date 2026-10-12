import { StackedBar } from '../charts/StackedBar'
import { shortDay } from '../charts/format'
import type { AnalyticsData } from '../../pages/app/analytics/useAnalytics'

const STATE = { planned: 'Planned', active: 'Running', completed: 'Completed' } as const

/**
 * What each sprint finished inside its own dates. What it was committed to at
 * the start is not recorded, so it is not claimed.
 */
export function SprintReport({ data }: { data: AnalyticsData }) {
  if (!data.scope.boardId) {
    return <p className="text-[13px] text-muted">Choose a group in the scope bar to see its sprints.</p>
  }
  if (data.shownSprints.length === 0) {
    return <p className="text-[13px] text-muted">This group has not planned any sprints.</p>
  }
  const max = Math.max(1, ...data.shownSprints.map((s) => s.tasks))
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[13px]">
        <caption className="sr-only">Sprints and what each finished in its window</caption>
        <thead>
          <tr className="border-b border-line text-left text-[12px] text-faint">
            <th scope="col" className="px-2 py-2 font-medium">Sprint</th>
            <th scope="col" className="px-2 py-2 font-medium">Dates</th>
            <th scope="col" className="px-2 py-2 font-medium">State</th>
            <th scope="col" className="px-2 py-2 font-medium">In window · after · open</th>
          </tr>
        </thead>
        <tbody>
          {data.shownSprints.map((s) => (
            <tr key={s.sprint_id} className="border-b border-line last:border-0">
              <th scope="row" className="px-2 py-2 text-left font-normal text-ink">{s.name}</th>
              <td className="px-2 py-2 font-mono text-[12px] text-muted">{shortDay(s.starts_on)} – {shortDay(s.ends_on)}</td>
              <td className="px-2 py-2 text-muted">{STATE[s.state]}</td>
              <td className="px-2 py-2">
                <div className="flex items-center gap-3">
                  <StackedBar
                    max={max}
                    parts={[
                      { label: 'finished in window', value: s.done_in_window, tone: 'done' },
                      { label: 'finished after', value: s.done - s.done_in_window, tone: 'late' },
                      { label: 'still open', value: s.tasks - s.done, tone: 'todo' },
                    ]}
                  />
                  <span className="shrink-0 font-mono text-[12px] text-faint">
                    {s.done_in_window} · {s.done - s.done_in_window} · {s.tasks - s.done}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
