import { Icon } from '../ui/Icon'
import { formatDue } from '../../lib/general/dates'
import { TASK_STATUSES } from '../../lib/general/progress'
import { axisTicks, groupRows, nowMarker, placeTask, timelineWindow } from '../../lib/general/timeline'
import type { TimelineTask } from '../../lib/general/timeline'
import type { GeneralProjectState } from './useGeneralProject'

const BAR = {
  todo: 'bg-navy-500/35',
  in_progress: 'bg-amber-400/70',
  done: 'bg-emerald-500/60',
} as const

const stageLabel = (status: TimelineTask['status']) =>
  (TASK_STATUSES.find((s) => s.value === status)?.label ?? status).toLowerCase()

/**
 * What a mouse tooltip and a screen reader both get for a bar, in words —
 * colour and position carry nothing for either of them. `placeTask` only
 * draws a bar once both dates exist, so the range is never partial here.
 */
function barLabel(task: TimelineTask) {
  const range = task.starts_at && task.due_at
    ? `${formatDue(task.starts_at)} to ${formatDue(task.due_at)}`
    : ''
  return `${task.title}, ${stageLabel(task.status)}, ${range}`
}

/**
 * A diamond stands for whichever one date the task has. Naming that date —
 * and saying whether it is the start or the due — is the only way a marker
 * with a single point in time reads as anything at all without colour or a
 * position to compare it against.
 */
function diamondLabel(task: TimelineTask) {
  const when = task.starts_at
    ? `starts ${formatDue(task.starts_at)}`
    : task.due_at
      ? `due ${formatDue(task.due_at)}`
      : 'no date set'
  return `${task.title}, ${stageLabel(task.status)}, ${when}`
}

/**
 * The project's whole timeline.
 *
 * A task with both a start and a due date draws a bar. A task with only one
 * of the two draws a marker on that single day — the legend calls it out as
 * one date only, since which date it is varies by task. A chart that drew
 * nothing until both dates were set would read as broken rather than as a
 * prompt.
 *
 * Drawn with CSS offsets rather than a chart library. The two shapes needed
 * here are a horizontal bar and a marker, and the entry bundle is 312 KB.
 */
export function GanttChart({ state }: { state: GeneralProjectState }) {
  const project = state.project
  if (!project) return null

  const tasks: TimelineTask[] = state.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    due_at: t.due_at,
    starts_at: t.starts_at,
    team_id: t.team_id,
  }))

  const window = timelineWindow(project, tasks)
  const rows = groupRows(tasks, state.teams)
  const ticks = axisTicks(window)
  const today = nowMarker(window)
  const undated = tasks.filter((t) => placeTask(t, window).shape === 'none').length

  if (window.source === 'none' || rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
        No task has a date yet, so there is nothing to lay out. Give a task a start or a due date
        and it appears here.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-[12px] text-faint">
        {window.source === 'project'
          ? "Across this project's own dates."
          : 'Across the dates its tasks carry — the project has no dates of its own.'}
        {undated > 0 &&
          ` ${undated} ${undated === 1 ? 'task has' : 'tasks have'} no date yet.`}
      </p>

      <div className="overflow-x-auto rounded-panel border border-line surface">
        <div className="min-w-[44rem]">
          <div className="relative flex border-b border-line px-3 py-1.5">
            <div className="w-[14rem] shrink-0" />
            <div className="relative h-4 flex-1">
              {ticks.map((t) => (
                <span
                  key={t.at}
                  className="absolute top-0 -translate-x-1/2 font-mono text-[10px] text-faint"
                  style={{ left: `${t.left}%` }}
                >
                  {t.label}
                </span>
              ))}
            </div>
          </div>

          {rows.map((row) => (
            <section key={row.team ?? 'loose'}>
              <p className="border-b border-line px-3 py-1 text-[11px] font-medium text-faint uppercase">
                {row.teamName}
              </p>
              {row.tasks.map((task) => {
                const place = placeTask(task, window)
                return (
                  <div key={task.id} className="flex items-center border-b border-line last:border-0">
                    <p className="w-[14rem] shrink-0 truncate px-3 py-2 text-[13px] text-ink">
                      {task.title}
                    </p>
                    <div className="relative h-8 flex-1">
                      {today !== null && (
                        <span
                          aria-hidden="true"
                          className="absolute top-0 bottom-0 w-px bg-amber-400/70"
                          style={{ left: `${today}%` }}
                        />
                      )}
                      {place.shape === 'bar' && (
                        <span
                          role="img"
                          tabIndex={0}
                          aria-label={barLabel(task)}
                          title={barLabel(task)}
                          className={`absolute top-1/2 h-3 -translate-y-1/2 rounded-full ${BAR[task.status]}`}
                          style={{ left: `${place.left}%`, width: `${place.width}%` }}
                        />
                      )}
                      {place.shape === 'diamond' && (
                        <span
                          role="img"
                          tabIndex={0}
                          aria-label={diamondLabel(task)}
                          title={diamondLabel(task)}
                          className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 ${BAR[task.status]}`}
                          style={{ left: `${place.left}%` }}
                        />
                      )}
                      {place.shape === 'none' && (
                        <span className="absolute top-1/2 left-0 -translate-y-1/2 text-[11px] text-faint">
                          No date yet
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      </div>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-faint">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-6 rounded-full bg-navy-500/35" />a task with a start and a due date
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rotate-45 bg-navy-500/35" />a task with one date only — start or due
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-px bg-amber-400/70" />
          today
        </span>
        <span className="flex items-center gap-1.5">
          <Icon name="info" size={12} />
          Set a start date on a task to give it a bar.
        </span>
      </p>
    </div>
  )
}
