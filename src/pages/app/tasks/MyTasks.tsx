import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert } from '../../../components/ui/Field'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { Select } from '../../../components/ui/Select'
import { EmptyState } from '../../../components/ui/Tabs'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../context/AuthContext'
import { myTasks, setTaskStatus } from '../../../lib/api/tasks'
import type { MyTask } from '../../../lib/api/tasks'
import { authErrorMessage } from '../../../lib/authError'
import { dueSoonLabel, TASK_STATUSES } from '../../../lib/types'
import type { TaskStatus } from '../../../lib/types'

const NEXT: Record<TaskStatus, { to: TaskStatus; label: string }> = {
  todo: { to: 'in_progress', label: 'Start' },
  in_progress: { to: 'done', label: 'Mark done' },
  done: { to: 'todo', label: 'Reopen' },
}

/** Everything the student has taken on, across every project, soonest first. */
export default function MyTasks() {
  const { profile } = useAuth()
  const { show } = useToast()
  const [tasks, setTasks] = useState<MyTask[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('open')

  const load = useCallback(async () => {
    if (!profile) return
    try {
      setTasks(await myTasks(profile.id))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load your tasks.'))
      setTasks([])
    }
  }, [profile])

  useEffect(() => {
    document.title = 'My tasks · Collabify'
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const shown = (tasks ?? []).filter((t) =>
    status === 'open' ? t.status !== 'done' : status ? t.status === status : true,
  )

  const overdue = shown.filter(
    (t) => t.due_at && new Date(t.due_at).getTime() < Date.now() && t.status !== 'done',
  ).length

  return (
    <div className="mx-auto w-full max-w-[880px]">
      <header>
        <p className="eyebrow text-amber-500 dark:text-amber-300">Workspace</p>
        <h1 className="mt-3 text-[clamp(1.9rem,3.4vw,2.5rem)] leading-tight">My tasks</h1>
        <p className="mt-2.5 max-w-[560px] text-[15.5px] text-muted">
          Everything you have taken on, across every project. Finishing these is what makes
          up your own grade.
        </p>
      </header>

      <div className="mt-8 space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        {overdue > 0 && (
          <Alert tone="error">
            {overdue} of these {overdue === 1 ? 'is' : 'are'} past their deadline.
          </Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13.5px] text-muted">
            {shown.length} {shown.length === 1 ? 'task' : 'tasks'}
          </p>
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="Everything"
            options={[
              { value: 'open', label: 'Still open' },
              ...TASK_STATUSES.map((s) => ({ value: s.value, label: s.label })),
            ]}
            className="!h-11 sm:max-w-[220px]"
          />
        </div>

        {tasks === null ? (
          <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Loading your tasks…
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            icon="check"
            title={tasks.length === 0 ? 'Nothing claimed yet' : 'Nothing here'}
            body={
              tasks.length === 0
                ? 'Open a project, find your group board, and take a task. Unclaimed work is waiting on somebody.'
                : 'Try a different filter.'
            }
          />
        ) : (
          <ul className="space-y-2.5">
            {shown.map((t) => {
              const due = dueSoonLabel(t.due_at)
              const late = due === 'Overdue' && t.status !== 'done'
              return (
                <li
                  key={t.id}
                  className="surface flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-line px-4 py-3.5 shadow-card"
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-[15px] font-medium ${
                        t.status === 'done' ? 'text-muted line-through' : 'text-ink'
                      }`}
                    >
                      {t.title}
                    </p>
                    <p className="mt-0.5 truncate text-[12.5px] text-muted">
                      <Link
                        to={`/student/projects/${t.project_id}`}
                        className="hover:underline"
                      >
                        {t.project_title}
                      </Link>
                      {' · '}
                      {t.class_initial}
                      {t.group_name ? ` · ${t.group_name}` : ''}
                    </p>
                  </div>

                  {due && (
                    <span
                      className={`flex shrink-0 items-center gap-1.5 font-mono text-[12px] ${
                        late ? 'text-red-600 dark:text-red-400' : 'text-faint'
                      }`}
                    >
                      <Icon name="clock" size={13} />
                      {due}
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await setTaskStatus(t.id, NEXT[t.status].to)
                        await load()
                      } catch (err) {
                        show(authErrorMessage(err, 'Could not move that task.'), 'error')
                      }
                    }}
                    className="shrink-0 rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-[var(--surface-sunken)]"
                  >
                    {NEXT[t.status].label}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
