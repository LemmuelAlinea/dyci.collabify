import { MilestoneLanes } from '../../../../components/analytics/MilestoneLanes'
import { SprintReport } from '../../../../components/analytics/SprintReport'
import { StuckWork } from '../../../../components/analytics/StuckWork'
import { ProgressBar } from '../../../../components/charts/ProgressBar'
import { useNow } from '../../../../hooks/useNow'
import { manilaDay } from '../../../../lib/analyticsMath'
import type { AnalyticsData } from '../useAnalytics'
import { Section } from './Section'

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

export function ProjectsView({ data, onOpenTask }: { data: AnalyticsData; onOpenTask: (id: string) => void }) {
  const today = manilaDay(new Date(useNow()))
  const projects = new Map<string, typeof data.shownBurns>()
  for (const b of data.shownBurns) projects.set(b.project_id, [...(projects.get(b.project_id) ?? []), b])
  const cycles = new Map(data.shownCycles.map((c) => [c.board_id, c]))

  return (
    <div className="space-y-5">
      <Section title="Projects compared" subtitle="Each group's progress per project, how hand-ins went, and how long they waited for your answer.">
        {projects.size === 0 ? (
          <p className="text-[13px] text-muted">No projects in view.</p>
        ) : (
          <ul className="grid gap-5 lg:grid-cols-2">
            {[...projects].map(([projectId, boards]) => {
              const handedIn = boards.filter((b) => b.submitted_at)
              const onTime = handedIn.filter((b) => !b.project_due_at || (b.submitted_at ?? '') <= b.project_due_at)
              const returns = avg(boards.map((b) => cycles.get(b.board_id)?.returns ?? 0))
              const waits = boards
                .map((b) => cycles.get(b.board_id)?.decision_hours)
                .filter((h): h is number => h !== null && h !== undefined)
                .map(Number)
              const wait = avg(waits)
              return (
                <li key={projectId} className="min-w-0 space-y-3 rounded-xl border border-line p-3.5">
                  <p className="truncate font-medium text-ink">{boards[0].project_title}</p>
                  <ul className="space-y-1.5">
                    {boards.map((b) => (
                      <li key={b.board_id} className="flex items-center gap-3 text-[12px]">
                        <span className="w-28 shrink-0 truncate text-muted">{b.group_name ?? b.student_name}</span>
                        <ProgressBar value={Number(b.done_pct)} />
                      </li>
                    ))}
                  </ul>
                  <dl className="grid grid-cols-3 gap-2 border-t border-line pt-3 text-[12px]">
                    <div>
                      <dt className="text-faint">On-time hand-ins</dt>
                      <dd className="font-mono text-ink">{handedIn.length ? `${onTime.length} of ${handedIn.length}` : '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-faint">Returns per group</dt>
                      <dd className="font-mono text-ink">{returns === null ? '—' : returns.toFixed(1)}</dd>
                    </div>
                    <div>
                      <dt className="text-faint">Wait for answer</dt>
                      <dd className="font-mono text-ink">{wait === null ? '—' : `${Math.round(wait)}h`}</dd>
                    </div>
                  </dl>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section title="Milestones" subtitle="Each group against each milestone. Met means every task tagged to it was done by its date.">
        <MilestoneLanes data={data} today={today} />
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Sprints" subtitle="What each sprint finished inside its own dates, what came after, and what is still open.">
          <SprintReport data={data} />
        </Section>
        <Section title="Stuck work" subtitle="In progress for a week or more. Usually a blocker nobody has said out loud.">
          <StuckWork data={data} onOpenTask={onOpenTask} />
        </Section>
      </div>
    </div>
  )
}
