import { AssigneePicker } from './AssigneePicker'
import { Icon } from '../ui/Icon'
import { dueSoonLabel, isMine } from '../../lib/types'
import type { GroupMember, ProjectTask, Role, TaskStatus } from '../../lib/types'

const NEXT: Record<TaskStatus, { to: TaskStatus; label: string; icon: 'check' | 'refresh' }> = {
  todo: { to: 'in_progress', label: 'Start', icon: 'check' },
  in_progress: { to: 'done', label: 'Mark done', icon: 'check' },
  done: { to: 'todo', label: 'Reopen', icon: 'refresh' },
}

export function TaskCard({
  task,
  members,
  viewerId,
  role,
  canWork,
  onStatus,
  onEdit,
  onDelete,
  onClaim,
  onRelease,
  onTrail,
}: {
  task: ProjectTask
  members: GroupMember[]
  viewerId: string | undefined
  role: Role
  /** False for a professor: they write the work, the group does it. */
  canWork: boolean
  onStatus: (status: TaskStatus) => Promise<void> | void
  onEdit: () => void
  onDelete: () => void
  onClaim: (studentId: string) => Promise<void> | void
  onRelease: (studentId: string) => Promise<void> | void
  onTrail: () => void
}) {
  const next = NEXT[task.status]
  const due = dueSoonLabel(task.due_at)
  const overdue = due === 'Overdue' && task.status !== 'done'
  const yours = viewerId ? isMine(task, viewerId) : false
  const frozen = task.status !== 'todo'
  const editable = role === 'professor' || !frozen

  return (
    <article
      className={`surface rounded-xl border p-3.5 shadow-card transition-colors ${
        yours ? 'border-amber-300 dark:border-amber-400/50' : 'border-line'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h4
          className={`min-w-0 text-[14.5px] leading-snug font-medium ${
            task.status === 'done' ? 'text-muted line-through' : 'text-ink'
          }`}
        >
          {task.title}
        </h4>
        <div className="flex shrink-0 items-center gap-0.5">
          {task.author_role === 'professor' && (
            <span
              title="Set by your professor"
              className="rounded-md bg-navy-50 px-1.5 py-0.5 font-mono text-[10px] text-navy-700 dark:bg-navy-500/18 dark:text-navy-100"
            >
              SET
            </span>
          )}
          {task.ai_generated && (
            <span title="Drafted with AI" className="text-faint">
              <Icon name="spark" size={13} />
            </span>
          )}
        </div>
      </div>

      {task.details && (
        <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-muted">
          {task.details}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <AssigneePicker
          task={task}
          members={members}
          viewerId={viewerId}
          canChange={canWork}
          onClaim={onClaim}
          onRelease={onRelease}
        />

        {due && (
          <span
            className={`flex items-center gap-1 font-mono text-[11.5px] ${
              overdue ? 'text-red-600 dark:text-red-400' : 'text-faint'
            }`}
          >
            <Icon name="clock" size={12} />
            {due}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2.5">
        {canWork ? (
          <button
            type="button"
            onClick={() => void onStatus(next.to)}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] font-medium text-navy-600 transition-colors hover:bg-[var(--surface-sunken)] dark:text-navy-200"
          >
            <Icon name={next.icon} size={14} />
            {next.label}
          </button>
        ) : (
          <span className="px-2 text-[12px] text-faint">
            {frozen ? 'Frozen — the group has started it' : 'Open to the group'}
          </span>
        )}

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onTrail}
            aria-label="History"
            className="grid h-7 w-7 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
          >
            <Icon name="clock" size={14} />
          </button>
          {editable && (
            <>
              <button
                type="button"
                onClick={onEdit}
                aria-label={`Edit ${task.title}`}
                className="grid h-7 w-7 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
              >
                <Icon name="edit" size={14} />
              </button>
              <button
                type="button"
                onClick={onDelete}
                aria-label={`Delete ${task.title}`}
                className="grid h-7 w-7 place-items-center rounded-full text-faint transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/12 dark:hover:text-red-400"
              >
                <Icon name="trash" size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  )
}
