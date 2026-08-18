import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Icon, Spinner } from '../ui/Icon'
import { EmptyState } from '../ui/Tabs'
import { Alert } from '../ui/Field'
import { TaskDetailModal } from '../tasks/detail/TaskDetailModal'
import { listGroupBoards } from '../../lib/api/groupWork'
import { listTasks } from '../../lib/api/tasks'
import { authErrorMessage } from '../../lib/authError'
import { boardWeight, dueSoonLabel, taskStatusLabel } from '../../lib/types'
import type { BoardSummary, ProjectTask, Role } from '../../lib/types'

const STATUS_TONE: Record<string, string> = {
  todo: 'surface-sunken text-muted',
  in_progress: 'bg-amber-400/18 text-amber-700 dark:text-amber-300',
  done: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
}

/**
 * The group's actual work, where the group is. Without this a student has to
 * leave the group, find the project, and find their board again to see the
 * tasks that belong to the very group they were looking at.
 */
export function GroupWork({
  groupId,
  role,
  viewerId,
}: {
  groupId: string
  role: Role
  viewerId: string | undefined
}) {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [tasks, setTasks] = useState<Record<string, ProjectTask[]>>({})
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [params, setParams] = useSearchParams()
  const openTask = params.get('task')

  const projectBase = role === 'professor' ? '/professor/projects' : '/student/projects'

  const load = useCallback(async () => {
    try {
      const rows = await listGroupBoards([groupId])
      setBoards(rows)
      setError(null)
      // One project is the common case, so open it rather than making them click.
      if (rows.length === 1) setOpen(rows[0].id)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load this group’s work.'))
      setBoards([])
    }
  }, [groupId])

  useEffect(() => {
    void load()
  }, [load])

  const loadTasks = useCallback(async (boardId: string) => {
    setLoadingTasks(true)
    try {
      const rows = await listTasks(boardId)
      setTasks((prev) => ({ ...prev, [boardId]: rows }))
    } catch {
      setTasks((prev) => ({ ...prev, [boardId]: [] }))
    } finally {
      setLoadingTasks(false)
    }
  }, [])

  useEffect(() => {
    if (open && !tasks[open]) void loadTasks(open)
  }, [open, tasks, loadTasks])

  function showTask(id: string | null) {
    const next = new URLSearchParams(params)
    if (id) next.set('task', id)
    else next.delete('task')
    setParams(next, { replace: !id })
  }

  if (boards === null) {
    return (
      <div className="flex items-center gap-2.5 py-8 text-[14px] text-muted">
        <Spinner size={16} />
        Loading this group’s work…
      </div>
    )
  }

  if (boards.length === 0) {
    return (
      <EmptyState
        icon="kanban"
        title="No projects for this group yet"
        body={
          role === 'professor'
            ? 'Set a project against this group set and it appears here, with the group’s board inside it.'
            : 'When your professor sets a project for these groups, its board shows up here.'
        }
      />
    )
  }

  const activeBoard = boards.find((b) => tasks[b.id]?.some((t) => t.id === openTask))

  return (
    <div className="space-y-3">
      {error && <Alert tone="error">{error}</Alert>}

      {boards.map((board) => {
        const expanded = open === board.id
        const list = tasks[board.id] ?? []
        const pct = Number(board.done_pct)
        return (
          <section key={board.id} className="surface rounded-card border border-line shadow-card">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : board.id)}
                aria-expanded={expanded}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              >
                <Icon
                  name="chevronRight"
                  size={15}
                  className={`shrink-0 text-faint transition-transform duration-200 ${
                    expanded ? 'rotate-90' : ''
                  }`}
                />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium text-ink">
                    {board.project_title}
                  </span>
                  <span className="block text-[12.5px] text-muted">
                    {board.task_count === 0
                      ? 'No tasks yet'
                      : `${board.done_count} of ${board.task_count} done`}
                    {board.unclaimed_count > 0 && (
                      <span className="text-amber-700 dark:text-amber-300">
                        {' · '}
                        {board.unclaimed_count} unclaimed
                      </span>
                    )}
                  </span>
                </span>
              </button>

              <span className="flex shrink-0 items-center gap-3">
                <span className="hidden h-1.5 w-24 overflow-hidden rounded-full surface-sunken sm:block">
                  <span
                    className="block h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="font-mono text-[12px] text-faint">{pct}%</span>
                <Link
                  to={`${projectBase}/${board.project_id}`}
                  className="flex items-center gap-1 text-[13px] font-medium text-navy-600 hover:underline dark:text-navy-200"
                >
                  Project
                  <Icon name="chevronRight" size={13} />
                </Link>
              </span>
            </div>

            {expanded && (
              <div className="border-t border-line px-4 py-3">
                {loadingTasks && !tasks[board.id] ? (
                  <p className="flex items-center gap-2 py-3 text-[13px] text-muted">
                    <Spinner size={14} />
                    Loading tasks…
                  </p>
                ) : list.length === 0 ? (
                  <p className="py-2 text-[13.5px] text-muted">
                    Nothing on this board yet.{' '}
                    <Link
                      to={`${projectBase}/${board.project_id}?tab=tasks`}
                      className="font-medium text-navy-600 hover:underline dark:text-navy-200"
                    >
                      Break the project down
                    </Link>
                    .
                  </p>
                ) : (
                  <ul className="divide-y divide-[var(--line)]">
                    {list.map((t) => {
                      const due = dueSoonLabel(t.due_at)
                      const overdue = due === 'Overdue' && t.status !== 'done'
                      const handedInLate = t.late && t.status === 'done'
                      return (
                        <li key={t.id}>
                          <button
                            type="button"
                            onClick={() => showTask(t.id)}
                            className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-left"
                          >
                            <span className="min-w-0 flex-1">
                              <span
                                className={`block truncate text-[14px] ${
                                  t.status === 'done'
                                    ? 'text-muted line-through'
                                    : 'text-ink hover:underline'
                                }`}
                              >
                                {t.title}
                              </span>
                              {t.assignees.length > 0 && (
                                <span className="block truncate text-[12px] text-faint">
                                  {t.assignees
                                    .map((a) =>
                                      a.profile
                                        ? `${a.profile.first_name} ${a.profile.last_name}`
                                        : '',
                                    )
                                    .filter(Boolean)
                                    .join(', ')}
                                </span>
                              )}
                              {t.assignees.length === 0 && (
                                <span className="block text-[12px] text-amber-700 dark:text-amber-300">
                                  Unclaimed
                                </span>
                              )}
                            </span>

                            {handedInLate && (
                              <span
                                title="Finished after the deadline"
                                className="shrink-0 rounded-md bg-red-500/15 px-1.5 py-0.5 font-mono text-[10.5px] text-red-700 dark:text-red-300"
                              >
                                Late
                              </span>
                            )}

                            {due && !handedInLate && (
                              <span
                                className={`shrink-0 font-mono text-[11.5px] ${
                                  overdue ? 'text-red-600 dark:text-red-400' : 'text-faint'
                                }`}
                              >
                                {due}
                              </span>
                            )}
                            <span
                              className={`shrink-0 rounded-lg px-2 py-0.5 font-mono text-[11px] ${
                                STATUS_TONE[t.status]
                              }`}
                            >
                              {taskStatusLabel(t.status)}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}
          </section>
        )
      })}

      <TaskDetailModal
        taskId={openTask}
        onClose={() => showTask(null)}
        viewerId={viewerId}
        role={role}
        boardWeight={activeBoard ? boardWeight(tasks[activeBoard.id] ?? []) : 0}
        onChanged={async () => {
          await load()
          if (open) await loadTasks(open)
        }}
      />
    </div>
  )
}
