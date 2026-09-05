import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
import { Link, useSearchParams } from 'react-router-dom'
import { Reveal } from '../../../components/motion/Reveal'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { TaskDetailModal } from '../../../components/tasks/detail/TaskDetailModal'
import { Alert } from '../../../components/ui/Alert'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { EmptyState } from '../../../components/ui/EmptyState'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../context/AuthContext'
import { myTasks, setTaskStatus } from '../../../lib/api/tasks'
import type { MyTask } from '../../../lib/api/tasks'
import { authErrorMessage } from '../../../lib/authError'
import { formatMinutes, taskShare, taskStatusLabel } from '../../../lib/types'
import type { TaskStatus } from '../../../lib/types'

const NEXT: Record<TaskStatus, { to: TaskStatus; label: string; icon: 'check' | 'refresh' }> = {
  todo: { to: 'in_progress', label: 'Start', icon: 'check' },
  in_progress: { to: 'done', label: 'Mark done', icon: 'check' },
  done: { to: 'todo', label: 'Reopen', icon: 'refresh' },
}

const DAY = 86_400_000

/** Buckets by urgency, because a flat list buries what is late. */
type BucketId = 'overdue' | 'today' | 'week' | 'later' | 'undated' | 'done'

const BUCKETS: {
  id: BucketId
  title: string
  blurb: string
  tone: string
  bar: string
}[] = [
  {
    id: 'overdue',
    title: 'Past due',
    blurb: 'These were expected already.',
    tone: 'text-red-600 dark:text-red-400',
    bar: 'bg-red-500',
  },
  {
    id: 'today',
    title: 'Due today',
    blurb: 'Finish these before the day is out.',
    tone: 'text-amber-700 dark:text-amber-300',
    bar: 'bg-amber-400',
  },
  {
    id: 'week',
    title: 'This week',
    blurb: 'Due in the next seven days.',
    tone: 'text-ink',
    bar: 'bg-navy-500',
  },
  {
    id: 'later',
    title: 'Later',
    blurb: 'Further out than a week.',
    tone: 'text-muted',
    bar: 'bg-[var(--line-strong)]',
  },
  {
    id: 'undated',
    title: 'No deadline',
    blurb: 'Nobody put a date on these.',
    tone: 'text-muted',
    bar: 'bg-[var(--line-strong)]',
  },
  {
    id: 'done',
    title: 'Finished',
    blurb: 'Done, and counting toward your grade.',
    tone: 'text-emerald-700 dark:text-emerald-300',
    bar: 'bg-emerald-500',
  },
]

function bucketOf(task: MyTask): BucketId {
  if (task.status === 'done') return 'done'
  if (!task.due_at) return 'undated'
  const left = new Date(task.due_at).getTime() - Date.now()
  if (left < 0) return 'overdue'
  if (left < DAY) return 'today'
  if (left < 7 * DAY) return 'week'
  return 'later'
}

function dueStamp(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function MyTasks() {
  const { profile } = useAuth()
  const { show } = useToast()
  const [tasks, setTasks] = useState<MyTask[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [params, setParams] = useSearchParams()
  const openTask = params.get('task')

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

  useLive(load, ['project_tasks', 'task_assignees', 'project_boards', 'projects'])

  function showTask(id: string | null) {
    const next = new URLSearchParams(params)
    if (id) next.set('task', id)
    else next.delete('task')
    setParams(next, { replace: !id })
  }

  const grouped = useMemo(() => {
    const map = new Map<BucketId, MyTask[]>()
    for (const t of tasks ?? []) {
      const b = bucketOf(t)
      map.set(b, [...(map.get(b) ?? []), t])
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'))
    }
    return map
  }, [tasks])

  const open = (tasks ?? []).filter((t) => t.status !== 'done')
  const overdue = grouped.get('overdue')?.length ?? 0
  const loggedTotal = (tasks ?? []).reduce((n, t) => n + t.logged_minutes, 0)
  const activeBoard = (tasks ?? []).find((t) => t.id === openTask)

  return (
    <div className="w-full">
      <DirectoryHero
        title="My"
        accent="tasks"
        description="What you have taken on across every project, ordered by what needs you first."
        action={
          <Link
            to="/student/projects"
            className="inline-flex items-center gap-2 rounded-lg border border-amber-50/20 bg-amber-50/8 px-4 py-2.5 text-[13px] font-medium text-amber-50 transition-colors hover:bg-amber-50/14"
          >
            Find work on project boards
            <Icon name="arrowRight" size={14} />
          </Link>
        }
        stats={[
          { label: 'Still open', value: tasks === null ? '—' : open.length },
          { label: 'Past due', value: tasks === null ? '—' : overdue },
          { label: 'Finished', value: tasks === null ? '—' : (tasks?.length ?? 0) - open.length },
          { label: 'Time logged', value: tasks === null ? '—' : formatMinutes(loggedTotal) },
        ]}
        statsVariant="compact-row"
      />

      <div className="mt-6 space-y-7">
        {error && <Alert tone="error">{error}</Alert>}

        {tasks === null ? (
          <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Loading your tasks…
          </div>
        ) : tasks.length === 0 ? (
          <EmptyState
            icon="check"
            art="tasks"
            title="Nothing claimed yet"
            body="Open a project, find your group's board, and take a task. Work nobody has claimed is waiting on somebody."
          />
        ) : (
          <>
            <nav aria-label="Jump to task group" className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-[12px] font-medium text-faint">Jump to</span>
              {BUCKETS.map((bucket) => {
                const count = grouped.get(bucket.id)?.length ?? 0
                if (count === 0) return null
                return (
                  <a
                    key={bucket.id}
                    href={`#tasks-${bucket.id}`}
                    className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-line-strong hover:text-ink"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${bucket.bar}`} />
                    {bucket.title}
                    <span className="font-mono text-faint">{count}</span>
                  </a>
                )
              })}
            </nav>

            {BUCKETS.map((bucket, i) => {
              const list = grouped.get(bucket.id) ?? []
              if (list.length === 0) return null
              return (
                <Reveal once delay={0.06 + i * 0.02} key={bucket.id}>
                  <section
                    id={`tasks-${bucket.id}`}
                    className="scroll-mt-28 overflow-hidden rounded-card border border-line surface"
                  >
                    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line surface-sunken px-4 py-3.5 sm:px-5">
                      <div className="flex items-center gap-3">
                        <span className={`h-2 w-2 rounded-full ${bucket.bar}`} />
                        <div>
                          <h2 className={bucket.tone}>{bucket.title}</h2>
                          <p className="mt-0.5 text-[12px] text-faint">{bucket.blurb}</p>
                        </div>
                      </div>
                      <span className="rounded-full surface px-2.5 py-1 font-mono text-[12px] text-muted ring-1 ring-[var(--line)]">
                        {list.length}
                      </span>
                    </header>

                    <ul className="divide-y divide-[var(--line)]">
                      {list.map((t) => {
                        const share = taskShare(t, t.board_weight || t.weight)
                        return (
                          <li
                            key={t.id}
                            className="group flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 transition-colors hover:bg-[var(--surface-sunken)] sm:px-5"
                          >
                            <button
                              type="button"
                              onClick={() => showTask(t.id)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <span
                                className={`block truncate text-[14px] font-medium ${
                                  t.status === 'done'
                                    ? 'text-muted line-through'
                                    : 'text-ink group-hover:underline'
                                }`}
                              >
                                {t.title}
                              </span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted">
                                <span className="max-w-full truncate">
                                  {t.project_title} · {t.class_initial}
                                  {t.group_name ? ` · ${t.group_name}` : ''}
                                </span>
                                {share > 0 && (
                                  <span className="font-mono text-faint">{share}%</span>
                                )}
                                {t.file_count > 0 && (
                                  <span className="flex items-center gap-1 text-faint">
                                    <Icon name="file" size={12} />
                                    {t.file_count}
                                  </span>
                                )}
                                {t.comment_count > 0 && (
                                  <span className="flex items-center gap-1 text-faint">
                                    <Icon name="message" size={12} />
                                    {t.comment_count}
                                  </span>
                                )}
                                {t.logged_minutes > 0 && (
                                  <span className="flex items-center gap-1 text-faint">
                                    <Icon name="clock" size={12} />
                                    {formatMinutes(t.logged_minutes)}
                                  </span>
                                )}
                              </span>
                            </button>

                            <span className="ml-auto flex shrink-0 items-center gap-3">
                              {t.due_at && (
                                <span
                                  className={`hidden font-mono text-[12px] sm:block ${
                                    bucket.id === 'overdue'
                                      ? 'text-red-600 dark:text-red-400'
                                      : 'text-faint'
                                  }`}
                                >
                                  {dueStamp(t.due_at)}
                                </span>
                              )}
                              <span
                                className={`rounded-lg px-2 py-0.5 font-mono text-[12px] ${
                                  t.status === 'in_progress'
                                    ? 'bg-amber-400/18 text-amber-700 dark:text-amber-300'
                                    : t.status === 'done'
                                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                      : 'surface-sunken text-muted'
                                }`}
                              >
                                {taskStatusLabel(t.status)}
                              </span>
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await setTaskStatus(t.id, NEXT[t.status].to)
                                    await load()
                                  } catch (err) {
                                    show(
                                      authErrorMessage(err, 'Could not move that task.'),
                                      'error',
                                    )
                                  }
                                }}
                                className="flex items-center gap-2 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:border-navy-400 hover:text-navy-600 dark:hover:border-navy-300 dark:hover:text-navy-200"
                              >
                                <Icon name={NEXT[t.status].icon} size={14} />
                                {NEXT[t.status].label}
                              </button>
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                </Reveal>
              )
            })}

            <p className="text-[12px] text-faint">Only the people on a task can move it.</p>
          </>
        )}
      </div>

      <TaskDetailModal
        taskId={openTask}
        onClose={() => showTask(null)}
        viewerId={profile?.id}
        role="student"
        boardWeight={activeBoard?.board_weight ?? 0}
        onChanged={load}
      />
    </div>
  )
}
