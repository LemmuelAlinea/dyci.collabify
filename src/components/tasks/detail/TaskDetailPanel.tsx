import { useState } from 'react'
import { Avatar } from '../../app/Avatar'
import { Icon } from '../../ui/Icon'
import { formatMinutes, fullName, taskStatusLabel } from '../../../lib/types'
import type { TaskDetail } from '../../../lib/types'

function when(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] items-start gap-3 py-2">
      <dt className="text-[12px] text-faint">{label}</dt>
      <dd className="min-w-0 text-[13px] text-ink">{children}</dd>
    </div>
  )
}

/** Everything about the task, folded away by default so the thread stays in view. */
export function TaskDetailPanel({
  task,
  share,
}: {
  task: TaskDetail
  /** This task's slice of the board's 100. */
  share: number
}) {
  // Open on a desktop, folded on a phone: expanded it pushes the description
  // and the thread a screen and a half down.
  const [open, setOpen] = useState(
    () => typeof window === 'undefined' || window.matchMedia('(min-width: 768px)').matches,
  )

  return (
    <section className="rounded-card border border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-sunken)]"
      >
        <Icon
          name="chevronRight"
          size={15}
          className={`shrink-0 text-faint transition-transform duration-200 ${
            open ? 'rotate-90' : ''
          }`}
        />
        <span className="text-[14px] font-semibold text-ink">Details</span>
        {!open && (
          <span className="min-w-0 truncate text-[12px] text-faint">
            Assignees, status, weight, dates, author
          </span>
        )}
      </button>

      {open && (
        <dl className="divide-y divide-[var(--line)] border-t border-line px-4 py-1">
          <Row label="Assignees">
            {task.assignees.length === 0 ? (
              <span className="text-faint">Unclaimed</span>
            ) : (
              <ul className="space-y-1.5">
                {task.assignees.map(
                  (a) =>
                    a.profile && (
                      <li key={a.student_id} className="flex items-center gap-2">
                        <Avatar profile={a.profile} size={22} />
                        <span className="truncate">{fullName(a.profile)}</span>
                      </li>
                    ),
                )}
              </ul>
            )}
          </Row>

          <Row label="Status">
            <span
              className={`rounded-lg px-2 py-0.5 font-mono text-[12px] ${
                task.status === 'done'
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : task.status === 'in_progress'
                    ? 'bg-amber-400/18 text-amber-700 dark:text-amber-300'
                    : 'surface-sunken text-muted'
              }`}
            >
              {taskStatusLabel(task.status)}
            </span>
          </Row>

          <Row label="Worth">
            <span className="font-mono">{share}%</span>
            <span className="ml-1.5 text-[12px] text-faint">of the project</span>
          </Row>

          <Row label="Started">{when(task.started_at)}</Row>
          <Row label="Due">{when(task.due_at)}</Row>
          <Row label="Finished">{when(task.done_at)}</Row>

          <Row label="Time logged">
            {task.logged_minutes > 0 ? (
              <span className="font-mono">{formatMinutes(task.logged_minutes)}</span>
            ) : (
              <span className="text-faint">None yet</span>
            )}
          </Row>

          <Row label="Created by">
            <span>{task.creator_name ?? 'Somebody'}</span>
            {task.author_role === 'professor' && (
              <span className="ml-1.5 rounded-md bg-navy-50 px-1.5 py-0.5 font-mono text-[12px] text-navy-700 dark:bg-navy-500/18 dark:text-navy-100">
                SET
              </span>
            )}
            <span className="block text-[12px] text-faint">{when(task.created_at)}</span>
          </Row>
        </dl>
      )}
    </section>
  )
}
