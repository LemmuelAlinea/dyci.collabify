import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
import { Link, useSearchParams } from 'react-router-dom'
import { Reveal } from '../../../components/motion/Reveal'
import { StatRow } from '../../../components/dashboard/DashSection'
import { TaskDetailModal } from '../../../components/tasks/detail/TaskDetailModal'
import { Alert } from '../../../components/ui/Alert'
import { Badge } from '../../../components/ui/Badge'
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
    <div className="mx-auto w-full max-w-[1280px]">
      <Reveal once>
        <p className="eyebrow text-amber-500 dark:text-amber-300">Workspace</p>
        <h1 className="mt-3 text-[clamp(1.9rem,3.4vw,2.5rem)] leading-tight">My tasks</h1>
        <p className="mt-2.5 max-w-[560px] text-[15.5px] text-muted">
          Everything you have taken on, across every project. Finishing these is what makes
          up your own grade.
        </p>
      </Reveal>

      <div className="mt-7 space-y-7">
        {error && <Alert tone="error">{error}</Alert>}

        {tasks === null ? (
          <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
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
            <Reveal once delay={0.04}>
              <StatRow
                stats={[
                  { label: 'Still open', value: open.length },
                  {
                    label: overdue === 1 ? 'Past due' : 'Past due',
                    value: overdue,
                    tone: overdue > 0 ? 'warn' : 'plain',
                  },
                  { label: 'Finished', value: tasks.length - open.length },
                  { label: 'Time logged', value: formatMinutes(loggedTotal) },
                ]}
              />
            </Reveal>

            {BUCKETS.map((bucket, i) => {
              const list = grouped.get(bucket.id) ?? []
              if (list.length === 0) return null
              return (
                <Reveal once delay={0.06 + i * 0.02} key={bucket.id}>
                  <section className="space-y-2.5">
                    <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h2 className={`flex items-center gap-2 text-[16px] ${bucket.tone}`}>
                        <span className={`h-2.5 w-2.5 rounded-full ${bucket.bar}`} />
                        {bucket.title}
                        <Badge>{list.length}</Badge>
                      </h2>
                      <p className="text-[12.5px] text-faint">{bucket.blurb}</p>
                    </header>

                    <ul className="space-y-2">
                      {list.map((t) => {
                        const share = taskShare(t, t.board_weight || t.weight)
                        return (
                          <li
                            key={t.id}
                            className="surface group flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-line px-4 py-3.5 shadow-card transition-colors duration-250 hover:border-line-strong hover:border-line-strong"
                          >
                            <span className={`h-9 w-1 shrink-0 rounded-full ${bucket.bar}`} />

                            <button
                              type="button"
                              onClick={() => showTask(t.id)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <span
                                className={`block truncate text-[15px] font-medium ${
                                  t.status === 'done'
                                    ? 'text-muted line-through'
                                    : 'text-ink group-hover:underline'
                                }`}
                              >
                                {t.title}
                              </span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-muted">
                                <span className="truncate">
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

                            <span className="flex shrink-0 items-center gap-3">
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
                                className={`rounded-lg px-2 py-0.5 font-mono text-[11px] ${
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
                                className="flex items-center gap-1.5 rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-[var(--surface-sunken)]"
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

            <p className="text-[12.5px] text-faint">
              Only the people on a task can move it.{' '}
              <Link
                to="/student/projects"
                className="font-medium text-navy-600 hover:underline dark:text-navy-200"
              >
                Claim more work
              </Link>{' '}
              from a project board.
            </p>
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
