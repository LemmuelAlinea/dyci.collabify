import { Avatar } from '../app/Avatar'
import { Icon } from '../ui/Icon'
import { EmptyState } from '../ui/Tabs'
import {
  dueSoonLabel,
  formatMinutes,
  fullName,
  taskShare,
  taskStatusLabel,
} from '../../lib/types'
import type { ProjectTaskRow } from '../../lib/api/tasks'

const STATUS_TONE: Record<string, string> = {
  todo: 'surface-sunken text-muted',
  in_progress: 'bg-amber-400/18 text-amber-700 dark:text-amber-300',
  done: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
}

/**
 * The same tasks as the board, one row each. A board is easy to read and hard
 * to scan — twenty tasks in three columns is a lot of scrolling to answer "who
 * has what".
 */
export function TaskList({
  rows,
  boardWeight,
  showOwner,
  ownerLabel,
  ownerFor,
  onOpen,
}: {
  rows: ProjectTaskRow[]
  /** Total weight per board, so each row's share is against its own board. */
  boardWeight: Map<string, number>
  /** Whether to name who each task belongs to — off on a student's own board. */
  showOwner: boolean
  /** 'Group' on a group project, 'Student' on an individual one. */
  ownerLabel: string
  ownerFor: (row: ProjectTaskRow) => string
  onOpen: (taskId: string) => void
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="search"
        title="Nothing matches"
        body="No task here fits those filters. Clear one and try again."
      />
    )
  }

  return (
    <div className="surface overflow-x-auto rounded-card border border-line shadow-card">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line text-[11.5px] tracking-wide text-faint uppercase">
            <th className="py-2.5 pr-3 pl-4 font-medium">Task</th>
            {showOwner && <th className="py-2.5 pr-3 font-medium">{ownerLabel}</th>}
            <th className="py-2.5 pr-3 font-medium">Assignees</th>
            <th className="py-2.5 pr-3 font-medium">Status</th>
            <th className="py-2.5 pr-3 font-medium">Worth</th>
            <th className="py-2.5 pr-3 font-medium">Due</th>
            <th className="py-2.5 pr-4 font-medium" />
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const due = dueSoonLabel(t.due_at)
            const overdue = due === 'Overdue' && t.status !== 'done'
            const handedInLate = t.late && t.status === 'done'
            const share = taskShare(t, boardWeight.get(t.board_id) || t.weight)
            return (
              <tr
                key={t.id}
                className="border-b border-line transition-colors last:border-0 hover:bg-[var(--surface-sunken)]"
              >
                <td className="py-2.5 pr-3 pl-4">
                  <button
                    type="button"
                    onClick={() => onOpen(t.id)}
                    className={`block max-w-[320px] truncate text-left text-[14px] font-medium hover:underline ${
                      t.status === 'done' ? 'text-muted line-through' : 'text-ink'
                    }`}
                  >
                    {t.title}
                  </button>
                  <span className="mt-0.5 flex items-center gap-2.5 text-[11.5px] text-faint">
                    {t.author_role === 'professor' && <span>Set by the professor</span>}
                    {t.file_count > 0 && (
                      <span className="flex items-center gap-1">
                        <Icon name="file" size={11} />
                        {t.file_count}
                      </span>
                    )}
                    {t.comment_count > 0 && (
                      <span className="flex items-center gap-1">
                        <Icon name="message" size={11} />
                        {t.comment_count}
                      </span>
                    )}
                    {t.logged_minutes > 0 && (
                      <span className="flex items-center gap-1">
                        <Icon name="clock" size={11} />
                        {formatMinutes(t.logged_minutes)}
                      </span>
                    )}
                  </span>
                </td>

                {showOwner && (
                  <td className="py-2.5 pr-3 text-[13px] text-muted">{ownerFor(t)}</td>
                )}

                <td className="py-2.5 pr-3">
                  {t.assignees.length === 0 ? (
                    <span className="text-[12.5px] text-amber-700 dark:text-amber-300">
                      Unclaimed
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <span className="flex">
                        {t.assignees.slice(0, 3).map(
                          (a) =>
                            a.profile && (
                              <span
                                key={a.student_id}
                                title={fullName(a.profile)}
                                className="-ml-1.5 rounded-full ring-2 ring-[var(--surface)] first:ml-0"
                              >
                                <Avatar profile={a.profile} size={22} />
                              </span>
                            ),
                        )}
                      </span>
                      <span className="max-w-[130px] truncate text-[12.5px] text-muted">
                        {t.assignees[0]?.profile
                          ? t.assignees.length > 1
                            ? `${t.assignees[0].profile.first_name} +${t.assignees.length - 1}`
                            : fullName(t.assignees[0].profile)
                          : ''}
                      </span>
                    </span>
                  )}
                </td>

                <td className="py-2.5 pr-3">
                  <span
                    className={`rounded-lg px-2 py-0.5 font-mono text-[11px] ${STATUS_TONE[t.status]}`}
                  >
                    {taskStatusLabel(t.status)}
                  </span>
                </td>

                <td className="py-2.5 pr-3 font-mono text-[12.5px] text-muted">{share}%</td>

                <td className="py-2.5 pr-3 font-mono text-[12px]">
                  {handedInLate ? (
                    <span
                      title="Finished after the deadline"
                      className="rounded-md bg-red-500/15 px-1.5 py-0.5 text-[10.5px] text-red-700 dark:text-red-300"
                    >
                      Late
                    </span>
                  ) : (
                    <span className={overdue ? 'text-red-600 dark:text-red-400' : 'text-faint'}>
                      {due ?? '—'}
                    </span>
                  )}
                </td>

                <td className="py-2.5 pr-4 text-right">
                  <button
                    type="button"
                    onClick={() => onOpen(t.id)}
                    aria-label={`Open ${t.title}`}
                    className="grid h-7 w-7 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
                  >
                    <Icon name="chevronRight" size={15} />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
