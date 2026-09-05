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

/**
 * The date, without the day-and-time stamp. Two of these cards fit across a
 * phone, and at 174px "Due in 3 days · Aug 27, 4:17 PM" wraps onto three lines
 * — which is more of the card than the deadline deserves. The stamp is still
 * there from `sm` up, where there is room for it.
 */
export function dueLabelShort(iso: string | null) {
  return dueLabel(iso).split(' · ')[0]
}

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
      <span className="shrink-0 rounded-lg surface-sunken px-2 py-1 font-mono text-[12px] text-muted">
        Archived
      </span>
    )
  }
  // Shut by the professor — which is not the same as being past its deadline.
  if (project.locked_at) {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-lg bg-navy-50 px-2 py-1 font-mono text-[12px] text-navy-700 dark:bg-navy-500/18 dark:text-navy-100">
        <Icon name="lock" size={12} />
        Closed
      </span>
    )
  }
  if (project.scheduled) {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-lg bg-amber-400/18 px-2 py-1 font-mono text-[12px] text-amber-700 dark:text-amber-300">
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
  audience,
  sections = 1,
}: {
  project: ProjectSummary
  to: string
  showClass?: boolean
  /** One board for a student, every group's board for a professor. */
  boards?: BoardSummary[]
  audience: 'mine' | 'class'
  /**
   * How many sections this project runs in, counted from the list the board
   * already holds — no extra query, and no column added to a view that three
   * files define.
   */
  sections?: number
}) {
  const progress = audience === 'mine' ? boards[0] : undefined
  const across = audience === 'class' ? summarise(boards) : null
  const meta = PROJECT_TYPES.find((t) => t.value === project.type)
  const overdue = project.due_at ? new Date(project.due_at).getTime() < Date.now() : false

  return (
    <Link
      to={to}
      className="group @container surface flex rounded-card border border-line shadow-card transition-colors duration-250 hover:border-line-strong hover:border-line-strong"
    >
      {/* The padding lives on this inner box, not on the card itself: an
          element cannot answer its own container query, so the card declares
          the container and everything inside it measures against that. */}
      <div className="flex w-full flex-col p-3.5 @min-[240px]:p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg surface-sunken text-muted">
            <Icon name={meta?.icon ?? 'folder'} size={16} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[12px] text-muted">
              {projectTypeLabel(project)}
            </span>
            <span className="block font-mono text-[12px] text-faint">
              {weekSpanLabel(project)}
            </span>
          </span>
        </span>
        <StatusPill project={project} />
      </div>

      {sections > 1 && (
        <p className="mt-2 flex items-center gap-2 text-[12px] text-faint">
          <Icon name="copy" size={12} className="shrink-0" />
          1 of {sections} sections
        </p>
      )}

      <h3 className="mt-2.5 line-clamp-2 leading-snug @min-[240px]:mt-3.5 @min-[240px]:">{project.title}</h3>

      {showClass && (
        <p className="mt-0.5 truncate text-[12px] text-muted @min-[240px]:mt-1 @min-[240px]:text-[12px]">
          {/* The initial is the part that identifies the class at a glance;
              the full name and the group set are what push this line past the
              width of a half-screen card. */}
          {project.class_initial}
          <span className="hidden @min-[240px]:inline">
            {' · '}
            {project.class_name}
            {project.group_set_name ? ` · ${project.group_set_name}` : ''}
          </span>
        </p>
      )}

      {project.week_assessments && (
        <p className="mt-2 hidden gap-2 text-[12px] leading-snug text-amber-700 @min-[240px]:mt-3 @min-[240px]:line-clamp-2 @min-[240px]:flex @min-[240px]:text-[12px] dark:text-amber-300">
          <Icon name="checkCircle" size={13} className="mt-0.5 shrink-0" />
          {project.week_assessments}
        </p>
      )}

      {/* A professor's card answers for the class, not for one group: how many
          boards there are, how many are in, and how far the work has got on
          average. Naming a single group here would be picking one at random. */}
      {across && across.boards > 0 && (
        <div className="mt-2.5 @min-[240px]:mt-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[12px]">
            <span className="text-muted">
              {across.boards} {across.boards === 1 ? 'board' : 'boards'} ·{' '}
              {across.submitted} in
              <span className="hidden @min-[240px]:inline">
                {across.accepted > 0 && ` · ${across.accepted} accepted`}
                {across.returned > 0 && ` · ${across.returned} returned`}
              </span>
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
            <p className="mt-1.5 text-[12px] text-amber-700 dark:text-amber-300">
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
          className={`mt-2.5 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] font-medium @min-[240px]:mt-3.5 @min-[240px]:text-[12px] ${
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
        <p className="mt-2.5 flex items-center gap-2 rounded-lg surface-sunken px-2.5 py-1.5 text-[12px] text-muted @min-[240px]:mt-3.5 @min-[240px]:text-[12px]">
          <Icon name="check" size={14} className="shrink-0" />
          Handed in · waiting on your professor
        </p>
      )}

      {progress && progress.task_count > 0 && (
        <div className="mt-2.5 @min-[240px]:mt-3.5">
          <div className="flex items-baseline justify-between gap-2 text-[12px]">
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

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2.5 text-[12px] text-muted @min-[240px]:gap-x-4 @min-[240px]:pt-4 @min-[240px]:text-[12px]">
        <span
          className={`flex items-center gap-2 ${
            overdue ? 'text-faint' : 'text-muted'
          }`}
        >
          <Icon name="clock" size={13} />
          <span className="@min-[240px]:hidden">{dueLabelShort(project.due_at)}</span>
          <span className="hidden @min-[240px]:inline">{dueLabel(project.due_at)}</span>
        </span>
        {/* Whether it is group work, and what it is out of, are answered on the
            project itself. On a half-screen card they cost two more lines. */}
        <span className="hidden items-center gap-2 @min-[240px]:flex">
          <Icon name={project.audience === 'group' ? 'users' : 'user'} size={13} />
          {project.audience === 'group' ? 'Group' : 'Individual'}
        </span>
        <span className="hidden font-mono text-faint @min-[240px]:inline">{project.total_points} pts</span>
      </div>
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
