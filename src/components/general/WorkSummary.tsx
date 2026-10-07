// src/components/general/WorkSummary.tsx
import { Avatar } from '../app/Avatar'
import { Icon } from '../ui/Icon'
import { WorkGlance } from '../work/WorkGlance'
import { SummaryTile, StatusDonut } from '../tasks/TaskSummary'
import { useNow } from '../../hooks/useNow'
import { dateRange, isOverdue } from '../../lib/general/dates'
import { projectProgress } from '../../lib/general/progress'
import type { GeneralTask } from '../../lib/general/types'
import type { WorkSection } from '../../lib/work/nav'
import { formatMinutes } from '../../lib/types'
import { ForecastPanel } from './ForecastPanel'
import { PressurePanel } from './PressurePanel'
import { generalWorkItems } from './workSource'
import type { GeneralProjectState } from './useGeneralProject'

const DAY = 86_400_000

/**
 * How the project is going, in the order somebody asks: what is running and what needs me,
 * how far, what moved this week, who carries it, will it finish, what is late. It took in
 * the old Progress tab; the timeline went to Tasks › Timeline.
 */
export function WorkSummary({
  state,
  onOpenTask,
  onSection,
}: {
  state: GeneralProjectState
  onOpenTask: (id: string) => void
  onSection: (s: WorkSection) => void
}) {
  const project = state.project
  if (!project) return null
  const progress = projectProgress(state.tasks)
  const me = state.viewerId
  const mine = new Set(me ? state.tasks.filter((t) => t.assignee_ids.includes(me)).map((t) => t.id) : [])

  return (
    <div className="space-y-6">
      <WorkGlance
        items={generalWorkItems(state)}
        sprints={state.sprints}
        milestones={state.milestones}
        mine={mine}
        canPlan={!state.archived && state.can('manage_tasks')}
        onOpenTask={onOpenTask}
        onSection={onSection}
      />

      <section className="rounded-panel border border-line surface p-4 sm:p-5">
        <h2>Where we are</h2>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-display text-[32px] leading-none font-bold text-ink">{progress.pct}%</span>
          <span className="text-[13px] text-muted">
            {progress.done} of {progress.total} tasks done
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full surface-sunken">
          <span className="block h-full rounded-full bg-progress" style={{ width: `${Math.min(100, progress.pct)}%` }} />
        </div>
        <p className="mt-2 text-[12px] text-faint">{dateRange(project.starts_on, project.ends_on)}</p>
      </section>

      {state.tasks.length > 0 && <WorkTaskSummary tasks={state.tasks} state={state} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-panel border border-line surface p-4 sm:p-5">
          <h2>Will we finish in time</h2>
          <p className="mt-0.5 mb-3 text-[12px] text-muted">The pace so far, carried forward. Counting, not a promise.</p>
          <ForecastPanel state={state} />
        </section>
        <section className="rounded-panel border border-line surface p-4 sm:p-5">
          <h2>Late, and landing next</h2>
          <p className="mt-0.5 mb-3 text-[12px] text-muted">The part of this page you can still act on.</p>
          <PressurePanel state={state} onOpen={onOpenTask} />
        </section>
      </div>
    </div>
  )
}

/** The class Summary's tiles and donut, over a work project's tasks. */
function WorkTaskSummary({ tasks, state }: { tasks: GeneralTask[]; state: GeneralProjectState }) {
  const now = useNow()
  const within = (at: string | null) => Boolean(at && now - new Date(at).getTime() < 7 * DAY)
  const counts = {
    todo: tasks.filter((t) => t.status === 'todo').length,
    in_progress: tasks.filter((t) => t.status === 'in_progress').length,
    done: tasks.filter((t) => t.status === 'done').length,
  }
  const dueSoon = tasks.filter(
    (t) => t.status !== 'done' && t.due_at && new Date(t.due_at).getTime() > now && new Date(t.due_at).getTime() - now < 7 * DAY,
  ).length
  const overdue = tasks.filter((t) => isOverdue(t.due_at, t.status)).length
  const unassigned = tasks.filter((t) => t.assignee_ids.length === 0 && t.status !== 'done').length
  const logged = tasks.reduce((n, t) => n + t.logged_minutes, 0)

  const load = new Map<string, { held: number; done: number }>()
  for (const t of tasks) {
    for (const id of t.assignee_ids) {
      const row = load.get(id) ?? { held: 0, done: 0 }
      row.held += 1
      if (t.status === 'done') row.done += 1
      load.set(id, row)
    }
  }

  return (
    <div className="space-y-5">
      <div className={`grid grid-cols-2 gap-3 ${overdue > 0 ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
        <SummaryTile icon="checkCircle" value={tasks.filter((t) => within(t.completed_at)).length} label="finished" sub="in the last 7 days" />
        <SummaryTile icon="edit" value={tasks.filter((t) => within(t.updated_at)).length} label="updated" sub="in the last 7 days" />
        <SummaryTile icon="plus" value={tasks.filter((t) => within(t.created_at)).length} label="created" sub="in the last 7 days" />
        <SummaryTile icon="calendar" value={dueSoon} label="due soon" sub="in the next 7 days" />
        {overdue > 0 && <SummaryTile icon="clock" tone="warn" value={overdue} label="overdue" sub="past their due date" />}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4 shadow-card sm:p-5">
          <h3>Where it stands</h3>
          <p className="mt-1 mb-4 text-[13px] text-muted">
            Every task, by stage.
            {logged > 0 && ` ${formatMinutes(logged)} logged against them.`}
          </p>
          <StatusDonut counts={counts} total={tasks.length} />
          {unassigned > 0 && (
            <p className="mt-4 flex items-center gap-2 text-[12px] text-warning-700 dark:text-warning-300">
              <Icon name="alert" size={13} />
              {unassigned} {unassigned === 1 ? 'task has' : 'tasks have'} nobody on them
            </p>
          )}
        </section>

        <section className="card p-4 shadow-card sm:p-5">
          <h3>Who is carrying what</h3>
          <p className="mt-1 mb-3 text-[13px] text-muted">Tasks held, and how many of them are finished.</p>
          {load.size === 0 ? (
            <p className="text-[13px] text-muted">Nobody holds a task yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {[...load.entries()]
                .sort((a, b) => b[1].held - a[1].held)
                .map(([id, p]) => {
                  const profile = state.members.find((m) => m.user_id === id)?.profile
                  return (
                    <li key={id} className="flex items-center gap-3 py-2.5 first:pt-0">
                      {profile && <Avatar profile={profile} size={28} />}
                      <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{state.nameOf(id)}</span>
                      <span className="h-1.5 w-24 overflow-hidden rounded-full surface-sunken">
                        <span
                          className="block h-full rounded-full bg-progress"
                          style={{ width: `${p.held ? (p.done / p.held) * 100 : 0}%` }}
                        />
                      </span>
                      <span className="w-14 shrink-0 text-right font-mono text-[12px] text-faint">
                        {p.done}/{p.held}
                      </span>
                    </li>
                  )
                })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
