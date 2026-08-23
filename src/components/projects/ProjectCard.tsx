import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import {
  PROJECT_TYPES,
  calendarDaysUntil,
  hasPassed,
  projectTypeLabel,
  weekSpanLabel,
} from '../../lib/types'
import type { BoardSummary, ProjectSummary } from '../../lib/types'

export function dueLabel(iso: string | null) {
  if (!iso) return 'No deadline'
  const due = new Date(iso)
  const stamp = due.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  if (hasPassed(iso)) return `Was due ${stamp}`
  const days = calendarDaysUntil(iso)
  if (days <= 0) return `Due today · ${stamp}`
  if (days === 1) return `Due tomorrow · ${stamp}`
  if (days <= 14) return `Due in ${days} days · ${stamp}`
  return `Due ${stamp}`
}

export function StatusPill({ project }: { project: ProjectSummary }) {
  if (project.archived_at) {
    return (
      <span className="shrink-0 rounded-lg surface-sunken px-2 py-1 font-mono text-[11px] text-muted">
        Archived
      </span>
    )
  }
  // Shut by the professor — which is not the same as being past its deadline.
  if (project.locked_at) {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-lg bg-navy-50 px-2 py-1 font-mono text-[11px] text-navy-700 dark:bg-navy-500/18 dark:text-navy-100">
        <Icon name="lock" size={12} />
        Closed
      </span>
    )
  }
  if (project.scheduled) {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-lg bg-amber-400/18 px-2 py-1 font-mono text-[11px] text-amber-700 dark:text-amber-300">
        <Icon name="clock" size={12} />
        Scheduled
      </span>
    )
  }
  return null
}

export function ProjectCard({
  project,
  to,
  showClass = true,
  boards = [],
  /**
   * Whose progress the card is reporting. `mine` is the viewer's own board and
   * speaks in the second person; `class` is every board on the project and
   * speaks about groups. A professor reading "accepted by your professor" was
   * the tell that one board had been mistaken for the whole project.
   */
  audience = 'mine',
}: {
  project: ProjectSummary
  to: string
  showClass?: boolean
  /** One board for a student, every group's board for a professor. */
  boards?: BoardSummary[]
  audience?: 'mine' | 'class'
}) {
  const progress = audience === 'mine' ? boards[0] : undefined
  const across = audience === 'class' ? summarise(boards) : null
  const meta = PROJECT_TYPES.find((t) => t.value === project.type)
  const overdue = project.due_at ? new Date(project.due_at).getTime() < Date.now() : false

  return (
    <Link
      to={to}
      className="group surface flex flex-col rounded-card border border-line p-5 shadow-card transition-[transform,box-shadow,border-color] duration-250 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg surface-sunken text-muted">
            <Icon name={meta?.icon ?? 'folder'} size={16} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[12px] text-muted">
              {projectTypeLabel(project)}
            </span>
            <span className="block font-mono text-[11px] text-faint">
              {weekSpanLabel(project)}
            </span>
          </span>
        </span>
        <StatusPill project={project} />
      </div>

      <h3 className="mt-3.5 line-clamp-2 text-[16.5px] leading-snug">{project.title}</h3>

      {showClass && (
        <p className="mt-1 truncate text-[12px] text-muted">
          {project.class_initial} · {project.class_name}
          {project.group_set_name ? ` · ${project.group_set_name}` : ''}
        </p>
      )}

      {project.week_assessments && (
        <p className="mt-3 line-clamp-2 flex gap-1.5 text-[12.5px] leading-snug text-amber-700 dark:text-amber-300">
          <Icon name="checkCircle" size={13} className="mt-0.5 shrink-0" />
          {project.week_assessments}
        </p>
      )}

      {/* A professor's card answers for the class, not for one group: how many
          boards there are, how many are in, and how far the work has got on
          average. Naming a single group here would be picking one at random. */}
      {across && across.boards > 0 && (
        <div className="mt-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[11.5px]">
            <span className="text-muted">
              {across.boards} {across.boards === 1 ? 'board' : 'boards'} ·{' '}
              {across.submitted} handed in
              {across.accepted > 0 && ` · ${across.accepted} accepted`}
              {across.returned > 0 && ` · ${across.returned} returned`}
            </span>
            <span className="font-mono text-faint">{across.pct}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full surface-sunken">
            <span
              className="block h-full rounded-full bg-emerald-500 transition-[width] duration-300"
              style={{ width: `${across.pct}%` }}
            />
          </div>
          {across.notStarted > 0 && (
            <p className="mt-1.5 text-[11.5px] text-amber-700 dark:text-amber-300">
              {across.notStarted} {across.notStarted === 1 ? 'group has' : 'groups have'} not
              started
            </p>
          )}
        </div>
      )}

      {/* What became of the work, when there is an answer. It sits above the
          progress because once a project is accepted, how far the tasks got is
          no longer what a student is scanning for. */}
      {progress?.result_verdict && (
        <p
          className={`mt-3.5 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium ${
            progress.result_verdict === 'accepted'
              ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200'
              : 'bg-amber-400/20 text-amber-800 dark:text-amber-200'
          }`}
        >
          <Icon
            name={progress.result_verdict === 'accepted' ? 'checkCircle' : 'refresh'}
            size={14}
            className="shrink-0"
          />
          {progress.result_verdict === 'accepted'
            ? 'Accepted by your professor'
            : 'Returned — needs another look'}
        </p>
      )}

      {/* Handed in and still waiting is its own state, and the one a student
          most often wants confirmed. */}
      {!progress?.result_verdict && progress?.submitted_at && (
        <p className="mt-3.5 flex items-center gap-1.5 rounded-lg surface-sunken px-2.5 py-1.5 text-[12.5px] text-muted">
          <Icon name="check" size={14} className="shrink-0" />
          Handed in · waiting on your professor
        </p>
      )}

      {progress && progress.task_count > 0 && (
        <div className="mt-3.5">
          <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
            <span className="text-muted">
              {progress.done_count} of {progress.task_count} tasks
            </span>
            <span className="font-mono text-faint">{Number(progress.done_pct)}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full surface-sunken">
            <span
              className="block h-full rounded-full bg-emerald-500 transition-[width] duration-300"
              style={{ width: `${Number(progress.done_pct)}%` }}
            />
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-4 text-[12px] text-muted">
        <span
          className={`flex items-center gap-1.5 ${
            overdue ? 'text-faint' : 'text-muted'
          }`}
        >
          <Icon name="clock" size={13} />
          {dueLabel(project.due_at)}
        </span>
        <span className="flex items-center gap-1.5">
          <Icon name={project.audience === 'group' ? 'users' : 'user'} size={13} />
          {project.audience === 'group' ? 'Group' : 'Individual'}
        </span>
        <span className="font-mono text-faint">{project.total_points} pts</span>
      </div>
    </Link>
  )
}

/** Every board on one project, added up for the professor's card. */
function summarise(boards: BoardSummary[]) {
  const tasks = boards.reduce((n, b) => n + b.task_count, 0)
  const done = boards.reduce((n, b) => n + b.done_count, 0)
  return {
    boards: boards.length,
    submitted: boards.filter((b) => b.submitted_at).length,
    accepted: boards.filter((b) => b.result_verdict === 'accepted').length,
    returned: boards.filter((b) => b.result_verdict === 'returned').length,
    notStarted: boards.filter((b) => b.task_count === 0 || b.done_count === 0).length,
    pct: tasks === 0 ? 0 : Math.round((done / tasks) * 100),
  }
}
