import { useState } from 'react'
import { BurnCard } from '../../../../components/analytics/BurnCard'
import { DiagnosisList } from '../../../../components/analytics/DiagnosisList'
import { ForecastSummary } from '../../../../components/analytics/ForecastSummary'
import { GroupHealthGrid } from '../../../../components/analytics/GroupHealthGrid'
import { Burnup } from '../../../../components/charts/Burnup'
import { CalendarHeat } from '../../../../components/charts/CalendarHeat'
import { ShareBar } from '../../../../components/charts/ShareBar'
import { LOW_SHARE_PCT, burnupSeries, manilaDay } from '../../../../lib/analyticsMath'
import type { AnalyticsData } from '../useAnalytics'
import { classWindow } from '../window'
import { Section } from './Section'

const SHOWN = 6

export function GroupsView({ data }: { data: AnalyticsData }) {
  const today = manilaDay(new Date())
  const [allBurns, setAllBurns] = useState(false)
  const groupBoards = data.shownBurns.filter((b) => b.group_id)
  const atRisk = data.shownBurns.filter((b) => !b.submitted_at && b.task_count > 0 && b.done_count < b.task_count)

  const board = data.scope.boardId ? groupBoards.find((b) => b.board_id === data.scope.boardId) : null
  const { from } = classWindow(data, today)
  const counts = new Map<string, number>()
  if (board) {
    for (const a of data.shownActivity) {
      if (a.board_id === board.board_id) counts.set(a.day, (counts.get(a.day) ?? 0) + a.n)
    }
  }

  const projectBoards = data.scope.projectId
    ? groupBoards.filter((b) => b.project_id === data.scope.projectId)
    : []
  const projectTasks = data.shownTasks.filter((t) => t.project_id === data.scope.projectId)
  const projectFrom = projectTasks.reduce<string>((min, t) => {
    const d = manilaDay(t.created_at)
    return d < min ? d : min
  }, today)

  return (
    <div className="space-y-5">
      <Section
        title="Group health"
        subtitle="Each group on the measures that predict trouble. Hover a heading's cells for what the number means."
      >
        <GroupHealthGrid data={data} today={today} />
      </Section>

      <Section
        title="Who holds the work"
        subtitle={`Each group's work split by who holds it. Anyone under ${LOW_SHARE_PCT}% is outlined. A count is a prompt for a conversation, not a verdict.`}
      >
        {groupBoards.length === 0 ? (
          <p className="text-[13px] text-muted">No group boards in view.</p>
        ) : (
          <ul className="grid gap-5 lg:grid-cols-2">
            {groupBoards.map((b) => {
              const members = data.shownMembers.filter((m) => m.board_id === b.board_id)
              return (
                <li key={b.board_id} className="min-w-0 space-y-2">
                  <p className="truncate text-[13px] text-ink">
                    {b.group_name} <span className="text-faint">· {b.project_title}</span>
                  </p>
                  <ShareBar
                    label={`${b.group_name ?? 'Group'} work split`}
                    shares={members.map((m) => ({
                      id: m.student_id,
                      name: m.student_name,
                      pct: Number(m.held_pct),
                      low: m.group_size >= 2 && Number(m.held_pct) < LOW_SHARE_PCT,
                    }))}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Groups side by side" subtitle="Burnup per group on one scale. Choose a project in the scope bar to compare its groups.">
          {projectBoards.length === 0 ? (
            <p className="text-[13px] text-muted">Choose a project to compare its groups.</p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {projectBoards.map((b) => {
                const pts = burnupSeries(projectTasks.filter((t) => t.board_id === b.board_id), projectFrom, today)
                return (
                  <li key={b.board_id} className="min-w-0">
                    <p className="mb-1 truncate text-[12px] text-muted">{b.group_name}</p>
                    {pts.length > 1 ? (
                      <Burnup compact points={pts} endDay={b.project_due_at ? manilaDay(b.project_due_at) : null} title={`${b.group_name} burnup`} />
                    ) : (
                      <p className="text-[12px] text-faint">No history yet.</p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        <Section title="When the group works" subtitle="Each square is a day. A dark column just before a deadline is cramming.">
          {board ? (
            <CalendarHeat counts={counts} from={from} to={today} title={`${board.group_name} activity by day`} />
          ) : (
            <p className="text-[13px] text-muted">Choose a group in the scope bar to see when it works.</p>
          )}
        </Section>
      </div>

      <Section title="Will each group finish on time" subtitle="Tasks finished per day since each board started, against the days left. Every figure is a division you can redo by hand.">
        <ForecastSummary burns={data.shownBurns} />
        {atRisk.length > 0 && (
          <>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {(allBurns ? atRisk : atRisk.slice(0, SHOWN)).map((b) => (
                <BurnCard key={b.board_id} burn={b} />
              ))}
            </ul>
            {atRisk.length > SHOWN && (
              <button
                type="button"
                onClick={() => setAllBurns((v) => !v)}
                className="text-[12px] font-medium text-navy-600 hover:underline dark:text-navy-200"
              >
                {allBurns ? 'Show fewer' : `Show the other ${atRisk.length - SHOWN}`}
              </button>
            )}
          </>
        )}
      </Section>

      <Section title="Why groups are behind" subtitle="Each cause is measured, and the number that shows it sits in the line.">
        <DiagnosisList rows={data.shownDiagnoses} />
      </Section>
    </div>
  )
}
