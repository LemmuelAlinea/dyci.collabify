import { LaneTimeline } from '../charts/LaneTimeline'
import type { Lane } from '../charts/LaneTimeline'
import { addDays, milestoneState } from '../../lib/analyticsMath'
import type { AnalyticsData } from '../../pages/app/analytics/useAnalytics'

/** Per project, one lane per group, a diamond per milestone in the colour of how that group met it. */
export function MilestoneLanes({ data, today }: { data: AnalyticsData; today: string }) {
  const byProject = new Map<string, typeof data.shownMilestones>()
  for (const m of data.shownMilestones) {
    byProject.set(m.project_id, [...(byProject.get(m.project_id) ?? []), m])
  }
  if (byProject.size === 0) {
    return <p className="text-[13px] text-muted">No project in view has milestones. Add them on a project's Work tab.</p>
  }
  const boardName = new Map(data.shownBurns.map((b) => [b.board_id, b.group_name ?? b.student_name ?? 'Board']))
  const title = new Map(data.shownBurns.map((b) => [b.project_id, b.project_title]))

  return (
    <div className="space-y-6">
      {[...byProject].map(([projectId, rows]) => {
        const days = [today, ...rows.map((r) => r.due_on)].sort()
        const boards = [...new Set(rows.map((r) => r.board_id))]
        const lanes: Lane[] = boards.map((boardId) => ({
          key: boardId,
          label: boardName.get(boardId) ?? 'Board',
          marks: rows
            .filter((r) => r.board_id === boardId)
            .map((r) => ({ key: r.milestone_id, day: r.due_on, label: r.name, state: milestoneState(r, today) })),
        }))
        return (
          <div key={projectId} className="space-y-2">
            <p className="text-[13px] font-medium text-ink">{title.get(projectId) ?? 'Project'}</p>
            <LaneTimeline
              lanes={lanes}
              from={addDays(days[0], -3)}
              to={addDays(days[days.length - 1], 3)}
              today={today}
              title={`${title.get(projectId) ?? 'Project'} milestones by group`}
            />
          </div>
        )
      })}
    </div>
  )
}
