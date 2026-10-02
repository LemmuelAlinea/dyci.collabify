import { Link } from 'react-router-dom'
import { TileEmpty } from '../dashboard/Bento'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { formatDue, isOverdue } from '../../lib/general/dates'
import { dayLabel } from '../../lib/general/dashboard'
import type { ComingDay } from '../../lib/general/dashboard'
import { TASK_STATUSES } from '../../lib/general/progress'
import { paths } from '../../lib/paths'
import type {
  GeneralProjectSummary,
  GeneralRepoChange,
  GeneralTask,
} from '../../lib/general/types'

/**
 * `flat` is for a panel sitting in a bento tile (the home page's Your work):
 * rows divided by hairlines instead of a card each, since the tile is the card.
 * The space home and My tasks keep the cards.
 */
const listClass = (flat: boolean) => (flat ? '-mx-2 divide-y divide-[var(--line)]' : 'space-y-2')

/** The one-line note a panel shows when it has nothing to list. */
function Quiet({ children, flat = false }: { children: string; flat?: boolean }) {
  if (flat) return <TileEmpty>{children}</TileEmpty>
  return (
    <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
      {children}
    </p>
  )
}

/** A row that goes somewhere: an icon, two lines, and a figure on the right. */
function Row({
  to,
  onClick,
  icon,
  title,
  context,
  aside,
  late = false,
  flat = false,
}: {
  to: string
  /** Opens the row in place instead of following `to`. */
  onClick?: () => void
  icon: IconName
  title: string
  context: string
  aside?: string
  late?: boolean
  flat?: boolean
}) {
  const shell = flat
    ? 'flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-[var(--surface-sunken)]'
    : `surface flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left shadow-card transition-colors hover:border-line-strong sm:px-4 sm:py-3 ${
        late ? 'border-danger-300 dark:border-danger-500/40' : 'border-line'
      }`
  const body = (
    <>
      <span
        className={`grid shrink-0 place-items-center rounded-lg ${flat ? 'h-7 w-7' : 'h-8 w-8'} ${
          late ? 'bg-danger-50 text-danger-600 dark:bg-danger-500/12 dark:text-danger-400' : 'surface-sunken text-muted'
        }`}
      >
        <Icon name={icon} size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-ink">{title}</span>
        <span className="block truncate text-[12px] text-muted">{context}</span>
      </span>
      {aside && (
        <span className={`shrink-0 font-mono text-[12px] ${late ? 'text-danger-600 dark:text-danger-400' : 'text-faint'}`}>
          {aside}
        </span>
      )}
    </>
  )
  return (
    <li>
      {onClick ? (
        <button type="button" onClick={onClick} className={shell}>
          {body}
        </button>
      ) : (
        <Link to={to} className={shell}>
          {body}
        </Link>
      )}
    </li>
  )
}

/**
 * What is stuck until this person answers it: reviews somebody asked them
 * for, and access requests on projects they own. Invitations are answered in
 * the Inbox.
 */
export function WaitingPanel({
  reviews,
  requests,
  projectName,
  flat = false,
}: {
  reviews: GeneralRepoChange[]
  requests: GeneralProjectSummary[]
  projectName: (id: string) => string
  flat?: boolean
}) {
  if (reviews.length + requests.length === 0) {
    return <Quiet flat={flat}>Nothing is waiting on you.</Quiet>
  }
  return (
    <div className="space-y-2">
      {(reviews.length > 0 || requests.length > 0) && (
        <ul className={listClass(flat)}>
          {reviews.map((r) => (
            <Row
              key={r.id}
              to={`${paths.project(r.project_id)}?tab=files`}
              icon="eye"
              title={r.title || 'A change to review'}
              context={`Review · ${projectName(r.project_id)}`}
              aside={`${r.files.length} ${r.files.length === 1 ? 'file' : 'files'}`}
              flat={flat}
            />
          ))}
          {requests.map((p) => (
            <Row
              key={p.id}
              to={`${paths.project(p.id)}?tab=members`}
              icon="shield"
              title={`${p.open_request_count} access ${p.open_request_count === 1 ? 'request' : 'requests'}`}
              context={p.name}
              flat={flat}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** Open work on this person, overdue first. Each row opens the task itself. */
export function MyTasksPanel({
  tasks,
  projectName,
  now,
  limit = 6,
  empty = 'No open tasks are assigned to you in this space.',
  onOpen,
  flat = false,
}: {
  tasks: GeneralTask[]
  projectName: (id: string) => string
  now: number
  limit?: number
  /** The space dashboard says "in this space"; the home page speaks for all of them. */
  empty?: string
  /** Open a task where the list is rather than on its project page. */
  onOpen?: (task: GeneralTask) => void
  flat?: boolean
}) {
  if (tasks.length === 0) return <Quiet flat={flat}>{empty}</Quiet>
  return (
    <ul className={listClass(flat)}>
      {tasks.slice(0, limit).map((t) => {
        const late = isOverdue(t.due_at, t.status, now)
        const stage = TASK_STATUSES.find((s) => s.value === t.status)?.label ?? ''
        return (
          <Row
            key={t.id}
            to={`${paths.project(t.project_id)}?task=${t.id}`}
            onClick={onOpen ? () => onOpen(t) : undefined}
            icon="check"
            title={t.title}
            context={`${projectName(t.project_id)} · ${stage}`}
            aside={late ? 'Overdue' : t.due_at ? formatDue(t.due_at) : 'No due date'}
            late={late}
            flat={flat}
          />
        )
      })}
    </ul>
  )
}

/** The next two weeks of deadlines and project ends, a heading per day. */
export function ComingUpPanel({
  days,
  projectName,
  now,
  flat = false,
}: {
  days: ComingDay[]
  projectName: (id: string) => string
  now: number
  flat?: boolean
}) {
  if (days.length === 0) return <Quiet flat={flat}>Nothing is due in the next two weeks.</Quiet>
  return (
    <ol className={flat ? 'space-y-3' : 'space-y-4'}>
      {days.map((d) => (
        <li key={d.day}>
          <p className={`eyebrow text-faint ${flat ? 'mb-1' : 'mb-2'}`}>{dayLabel(d.at, now)}</p>
          <ul className={listClass(flat)}>
            {d.items.map((i) =>
              i.kind === 'task' ? (
                <Row
                  key={`t-${i.id}`}
                  to={`${paths.project(i.projectId)}?task=${i.id}`}
                  icon="clock"
                  title={i.title}
                  context={projectName(i.projectId)}
                  aside={new Date(i.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  flat={flat}
                />
              ) : (
                <Row
                  key={`p-${i.id}`}
                  to={paths.project(i.id)}
                  icon="target"
                  title={`${i.title} ends`}
                  context="Project end date"
                  flat={flat}
                />
              ),
            )}
          </ul>
        </li>
      ))}
    </ol>
  )
}

/** The projects somebody was last in, with how far along each one is. */
export function RecentPanel({
  projects,
  flat = false,
}: {
  projects: GeneralProjectSummary[]
  flat?: boolean
}) {
  if (projects.length === 0) return <Quiet flat={flat}>No projects in this space yet.</Quiet>
  return (
    <ul className={listClass(flat)}>
      {projects.map((p) => {
        const pct = Math.min(100, Number(p.progress_pct))
        return (
          <li key={p.id}>
            <Link
              to={paths.project(p.id)}
              className={
                flat
                  ? 'block rounded-lg px-2 py-2.5 transition-colors hover:bg-[var(--surface-sunken)]'
                  : 'surface block rounded-xl border border-line px-3 py-2.5 shadow-card transition-colors hover:border-line-strong sm:px-4 sm:py-3'
              }
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[14px] font-medium text-ink">{p.name}</span>
                <span className="shrink-0 font-mono text-[12px] text-faint">{pct}%</span>
              </span>
              <span className="mt-2 block h-1.5 overflow-hidden rounded-full surface-sunken">
                <span className="block h-full rounded-full bg-progress" style={{ width: `${pct}%` }} />
              </span>
              <span className="mt-1.5 block text-[12px] text-muted">
                {p.done_count}/{p.task_count} tasks done
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
