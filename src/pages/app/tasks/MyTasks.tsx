import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
import { useSearchParams } from 'react-router-dom'
import { ButtonLink } from '../../../components/ui/Button'
import { Reveal } from '../../../components/motion/Reveal'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { MyTasksPanel } from '../../../components/general/DashboardPanels'
import { TaskDetailModal } from '../../../components/tasks/detail/TaskDetailModal'
import { Alert } from '../../../components/ui/Alert'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { EmptyState } from '../../../components/ui/EmptyState'
import { ScopeFilter } from '../../../components/ui/ScopeFilter'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../context/AuthContext'
import { useGeneralNavigation } from '../../../context/generalNavigation'
import { useGeneralDashboard } from '../../../hooks/useGeneralDashboard'
import { myTasks as myClassTasks, setTaskStatus } from '../../../lib/api/tasks'
import type { MyTask } from '../../../lib/api/tasks'
import { membershipOf, showsClassScope } from '../../../lib/access'
import { authErrorMessage } from '../../../lib/authError'
import { myTasks as myOpenWorkTasks } from '../../../lib/general/dashboard'
import { paths } from '../../../lib/paths'
import { readScope, writeScope } from '../../../lib/scope'
import { formatMinutes, taskShare, taskStatusLabel } from '../../../lib/types'
import { useNow } from '../../../hooks/useNow'
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
    tone: 'text-danger-600 dark:text-danger-400',
    bar: 'bg-danger-500',
  },
  {
    id: 'today',
    title: 'Due today',
    blurb: 'Finish these before the day is out.',
    tone: 'text-warning-700 dark:text-warning-300',
    bar: 'bg-warning-400',
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
    tone: 'text-success-700 dark:text-success-300',
    bar: 'bg-success-500',
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
  const isStudent = profile?.role === 'student'
  const [classTasks, setClassTasks] = useState<MyTask[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [params, setParams] = useSearchParams()
  const openTask = params.get('task')
  // Only students are ever given class tasks, so everyone else reads work
  // alone. A student gets the filter only once somebody has invited them to
  // some work; until then they read everything. Either way a stale `?show=`
  // cannot empty the page.
  const general = useGeneralNavigation()
  const filtered = isStudent && showsClassScope(profile, membershipOf(general.spaces, general.myProjects))
  const scope = filtered ? readScope(params) : isStudent ? 'all' : 'work'

  // Class boards only ever assign work to students — a professor or admin
  // reading this page has none, so their load is a no-op rather than a
  // request that always comes back empty.
  const load = useCallback(async () => {
    if (!profile) return
    if (!isStudent) {
      setClassTasks([])
      setError(null)
      return
    }
    try {
      setClassTasks(await myClassTasks(profile.id))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load your tasks.'))
      setClassTasks([])
    }
  }, [profile, isStudent])

  useEffect(() => {
    document.title = 'My tasks · Collabify'
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Class boards only ever assign work to students, so `load` above is a
  // no-op for anyone else — no reason to hold a realtime channel or poll for
  // a table that will never change this page's data.
  useLive(load, ['project_tasks', 'task_assignees', 'project_boards', 'projects'], {
    enabled: isStudent,
  })

  // Work tasks: the same read the General home uses for "My tasks", open to
  // every role since work spaces are not education-only.
  const {
    myProjects,
    error: navError,
    reload: reloadNav,
  } = useGeneralNavigation()
  const mineProjects = useMemo(
    () => (myProjects ?? []).filter((p) => p.my_level && !p.archived_at),
    [myProjects],
  )
  const projectIds = useMemo(() => mineProjects.map((p) => p.id), [mineProjects])
  const {
    data: dashData,
    error: dashError,
    reload: reloadDash,
  } = useGeneralDashboard(profile?.id, projectIds)
  const clock = useNow()
  const now = dashData?.at ?? clock
  const projectName = useCallback(
    (id: string) => mineProjects.find((p) => p.id === id)?.name ?? 'A project',
    [mineProjects],
  )
  const workTasks = useMemo(
    () => (profile && dashData ? myOpenWorkTasks(dashData.tasks, profile.id) : []),
    [profile, dashData],
  )

  function showTask(id: string | null) {
    const next = new URLSearchParams(params)
    if (id) next.set('task', id)
    else next.delete('task')
    setParams(next, { replace: !id })
  }

  // Scoped down to what the All · Classes · Work filter should show.
  const classFiltered = useMemo(() => (scope === 'work' ? [] : (classTasks ?? [])), [scope, classTasks])
  const workFiltered = scope === 'classes' ? [] : workTasks

  const grouped = useMemo(() => {
    const map = new Map<BucketId, MyTask[]>()
    for (const t of classFiltered) {
      const b = bucketOf(t)
      map.set(b, [...(map.get(b) ?? []), t])
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'))
    }
    return map
  }, [classFiltered])

  // A General failure settles the work side rather than holding class tasks
  // hostage — the error Alert below shows it, with a retry, and class tasks
  // still render.
  const loaded =
    (isStudent ? classTasks !== null : true) &&
    myProjects !== null &&
    (dashData !== null || dashError !== null)
  const totalShown = classFiltered.length + workFiltered.length
  const activeBoard = (classTasks ?? []).find((t) => t.id === openTask)
  const loadError = error ?? navError ?? dashError

  const emptyCopy =
    scope === 'classes'
      ? { title: 'No class tasks', body: 'No class tasks are assigned to you.' }
      : scope === 'work'
        ? { title: 'No work tasks', body: 'No open work tasks are assigned to you.' }
        : { title: 'Nothing claimed yet', body: 'Nothing is assigned to you right now.' }

  return (
    <div className="w-full">
      <DirectoryHero
        title="My"
        accent="tasks"
        description="What you have taken on across every project, ordered by what needs you first."
        action={
          isStudent ? (
            <ButtonLink variant="onNavy" size="sm" to={paths.classProjects}>
              Find work on project boards
              <Icon name="arrowRight" size={14} />
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="mt-6 space-y-7">
        {loadError && (
          <Alert tone="error" onRetry={() => void Promise.all([load(), reloadNav(), reloadDash()])}>
            {loadError}
          </Alert>
        )}

        {filtered && (
          <div className="flex justify-end">
            <ScopeFilter
              value={scope}
              onChange={(next) => setParams(writeScope(params, next), { replace: true })}
              counts={
                loaded
                  ? {
                      all: (classTasks?.length ?? 0) + workTasks.length,
                      classes: classTasks?.length ?? 0,
                      work: workTasks.length,
                    }
                  : undefined
              }
            />
          </div>
        )}

        {!loaded ? (
          <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Loading your tasks…
          </div>
        ) : totalShown === 0 ? (
          <EmptyState icon="check" art="tasks" title={emptyCopy.title} body={emptyCopy.body} />
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
              {workFiltered.length > 0 && (
                <a
                  href="#tasks-work"
                  className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-line-strong hover:text-ink"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-navy-500" />
                  Work
                  <span className="font-mono text-faint">{workFiltered.length}</span>
                </a>
              )}
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
                                      ? 'text-danger-600 dark:text-danger-400'
                                      : 'text-faint'
                                  }`}
                                >
                                  {dueStamp(t.due_at)}
                                </span>
                              )}
                              <span
                                className={`rounded-lg px-2 py-0.5 font-mono text-[12px] ${
                                  t.status === 'in_progress'
                                    ? 'bg-warning-400/18 text-warning-700 dark:text-warning-300'
                                    : t.status === 'done'
                                      ? 'bg-success-500/15 text-success-700 dark:text-success-300'
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

            {workFiltered.length > 0 && (
              <Reveal once delay={0.06 + BUCKETS.length * 0.02}>
                <section
                  id="tasks-work"
                  className="scroll-mt-28 overflow-hidden rounded-card border border-line surface"
                >
                  <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line surface-sunken px-4 py-3.5 sm:px-5">
                    <div className="flex items-center gap-3">
                      <span className="h-2 w-2 rounded-full bg-navy-500" />
                      <div>
                        <h2 className="text-navy-700 dark:text-navy-300">Work</h2>
                        <p className="mt-0.5 text-[12px] text-faint">
                          Open tasks on your projects, across every space.
                        </p>
                      </div>
                    </div>
                    <span className="rounded-full surface px-2.5 py-1 font-mono text-[12px] text-muted ring-1 ring-[var(--line)]">
                      {workFiltered.length}
                    </span>
                  </header>

                  <div className="p-4 sm:p-5">
                    <MyTasksPanel
                      tasks={workFiltered}
                      projectName={projectName}
                      now={now}
                      limit={workFiltered.length}
                      empty="No open work tasks are assigned to you."
                    />
                  </div>
                </section>
              </Reveal>
            )}

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
