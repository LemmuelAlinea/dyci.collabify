import { Link } from 'react-router-dom'
import { Avatar } from '../app/Avatar'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { formatDue, isOverdue } from '../../lib/general/dates'
import { dayLabel } from '../../lib/general/dashboard'
import type { ComingDay } from '../../lib/general/dashboard'
import { TASK_STATUSES } from '../../lib/general/progress'
import { fullName } from '../../lib/types'
import type {
  GeneralProjectSummary,
  GeneralRepoChange,
  GeneralTask,
  MyInvitation,
} from '../../lib/general/types'

/** The one-line note a panel shows when it has nothing to list. */
function Quiet({ children }: { children: string }) {
  return (
    <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
      {children}
    </p>
  )
}

/** A row that goes somewhere: an icon, two lines, and a figure on the right. */
function Row({
  to,
  icon,
  title,
  context,
  aside,
  late = false,
}: {
  to: string
  icon: IconName
  title: string
  context: string
  aside?: string
  late?: boolean
}) {
  return (
    <li>
      <Link
        to={to}
        className={`surface flex items-center gap-3 rounded-xl border px-3 py-2.5 shadow-card transition-colors hover:border-line-strong sm:px-4 sm:py-3 ${
          late ? 'border-red-300 dark:border-red-500/40' : 'border-line'
        }`}
      >
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
            late ? 'bg-red-50 text-red-600 dark:bg-red-500/12 dark:text-red-400' : 'surface-sunken text-muted'
          }`}
        >
          <Icon name={icon} size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-ink">{title}</span>
          <span className="block truncate text-[12px] text-muted">{context}</span>
        </span>
        {aside && (
          <span className={`shrink-0 font-mono text-[12px] ${late ? 'text-red-600 dark:text-red-400' : 'text-faint'}`}>
            {aside}
          </span>
        )}
      </Link>
    </li>
  )
}

/**
 * Everything that is stuck until this person answers it: invitations, reviews
 * somebody asked them for, and access requests on projects they own.
 */
export function WaitingPanel({
  invitations,
  reviews,
  requests,
  projectName,
  answering,
  onAnswer,
}: {
  invitations: MyInvitation[]
  reviews: GeneralRepoChange[]
  requests: GeneralProjectSummary[]
  projectName: (id: string) => string
  answering: string | null
  onAnswer: (inv: MyInvitation, accept: boolean) => void
}) {
  if (invitations.length + reviews.length + requests.length === 0) {
    return <Quiet>Nothing is waiting on you.</Quiet>
  }
  return (
    <div className="space-y-2">
      {invitations.length > 0 && (
        <ul className="overflow-hidden rounded-xl border border-amber-300 bg-amber-400/6 dark:border-amber-400/40 dark:bg-amber-400/8">
          {invitations.map((inv) => (
            <li
              key={inv.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2.5 border-b border-amber-300/50 px-3 py-3 last:border-b-0 sm:px-4 dark:border-amber-400/20"
            >
              {inv.inviter && <Avatar profile={inv.inviter} size={30} />}
              <div className="min-w-[10rem] flex-1">
                <p className="text-[14px] font-medium text-ink">{inv.project?.name ?? 'A project'}</p>
                <p className="mt-0.5 text-[12px] text-muted">
                  {inv.inviter ? `${fullName(inv.inviter)} invited you` : 'You were invited'}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" disabled={answering === inv.id} onClick={() => onAnswer(inv, false)}>
                  Decline
                </Button>
                <Button size="sm" loading={answering === inv.id} onClick={() => onAnswer(inv, true)}>
                  <Icon name="check" size={14} />
                  Join
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {(reviews.length > 0 || requests.length > 0) && (
        <ul className="space-y-2">
          {reviews.map((r) => (
            <Row
              key={r.id}
              to={`/general/projects/${r.project_id}?tab=files`}
              icon="eye"
              title={r.title || 'A change to review'}
              context={`Review · ${projectName(r.project_id)}`}
              aside={`${r.files.length} ${r.files.length === 1 ? 'file' : 'files'}`}
            />
          ))}
          {requests.map((p) => (
            <Row
              key={p.id}
              to={`/general/projects/${p.id}?tab=members`}
              icon="shield"
              title={`${p.open_request_count} access ${p.open_request_count === 1 ? 'request' : 'requests'}`}
              context={p.name}
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
}: {
  tasks: GeneralTask[]
  projectName: (id: string) => string
  now: number
  limit?: number
}) {
  if (tasks.length === 0) return <Quiet>No open tasks are assigned to you in this space.</Quiet>
  return (
    <ul className="space-y-2">
      {tasks.slice(0, limit).map((t) => {
        const late = isOverdue(t.due_at, t.status, now)
        const stage = TASK_STATUSES.find((s) => s.value === t.status)?.label ?? ''
        return (
          <Row
            key={t.id}
            to={`/general/projects/${t.project_id}?task=${t.id}`}
            icon="check"
            title={t.title}
            context={`${projectName(t.project_id)} · ${stage}`}
            aside={late ? 'Overdue' : t.due_at ? formatDue(t.due_at) : 'No due date'}
            late={late}
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
}: {
  days: ComingDay[]
  projectName: (id: string) => string
  now: number
}) {
  if (days.length === 0) return <Quiet>Nothing is due in the next two weeks.</Quiet>
  return (
    <ol className="space-y-4">
      {days.map((d) => (
        <li key={d.day}>
          <p className="eyebrow mb-2 text-faint">{dayLabel(d.at, now)}</p>
          <ul className="space-y-2">
            {d.items.map((i) =>
              i.kind === 'task' ? (
                <Row
                  key={`t-${i.id}`}
                  to={`/general/projects/${i.projectId}?task=${i.id}`}
                  icon="clock"
                  title={i.title}
                  context={projectName(i.projectId)}
                  aside={new Date(i.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                />
              ) : (
                <Row
                  key={`p-${i.id}`}
                  to={`/general/projects/${i.id}`}
                  icon="target"
                  title={`${i.title} ends`}
                  context="Project end date"
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
export function RecentPanel({ projects }: { projects: GeneralProjectSummary[] }) {
  if (projects.length === 0) return <Quiet>No projects in this space yet.</Quiet>
  return (
    <ul className="space-y-2">
      {projects.map((p) => {
        const pct = Math.min(100, Number(p.progress_pct))
        return (
          <li key={p.id}>
            <Link
              to={`/general/projects/${p.id}`}
              className="surface block rounded-xl border border-line px-3 py-2.5 shadow-card transition-colors hover:border-line-strong sm:px-4 sm:py-3"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[14px] font-medium text-ink">{p.name}</span>
                <span className="shrink-0 font-mono text-[12px] text-faint">{pct}%</span>
              </span>
              <span className="mt-2 block h-1.5 overflow-hidden rounded-full surface-sunken">
                <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
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
