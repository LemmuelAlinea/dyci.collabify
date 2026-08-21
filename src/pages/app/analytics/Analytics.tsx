import { useCallback, useEffect, useMemo, useState } from 'react'
import { BurnCard } from '../../../components/analytics/BurnCard'
import { EMPTY_SCOPE, FilterChain } from '../../../components/analytics/FilterChain'
import type { Scope } from '../../../components/analytics/FilterChain'
import { GapList } from '../../../components/analytics/GapList'
import { MemberLoad } from '../../../components/analytics/MemberLoad'
import { PaceCard } from '../../../components/analytics/PaceCard'
import { UnmeasuredList } from '../../../components/analytics/UnmeasuredList'
import { TaskDetailModal } from '../../../components/tasks/detail/TaskDetailModal'
import { Alert } from '../../../components/ui/Field'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { EmptyState } from '../../../components/ui/Tabs'
import { useAuth } from '../../../context/AuthContext'
import {
  boardBurn,
  classGaps,
  classHealth,
  classPace,
  classesUnmeasured,
  memberLoad,
  taskStates,
} from '../../../lib/api/analytics'
import { authErrorMessage } from '../../../lib/authError'
import { dueSoonLabel, taskStatusLabel } from '../../../lib/types'
import type {
  BoardBurn,
  ClassGap,
  ClassHealth,
  ClassPace,
  ClassUnmeasured,
  MemberLoad as Load,
  TaskState,
} from '../../../lib/types'

function Tile({ value, label, tone }: { value: number | string; label: string; tone?: 'warn' }) {
  return (
    <div className="surface rounded-card border border-line px-4 py-3 shadow-card">
      <p
        className={`font-mono text-[19px] ${
          tone === 'warn' && value !== 0 ? 'text-red-600 dark:text-red-400' : 'text-ink'
        }`}
      >
        {value}
      </p>
      <p className="text-[12px] text-muted">{label}</p>
    </div>
  )
}

/**
 * What is happening across a professor's classes, at whatever depth they ask.
 *
 * Everything is counted, not guessed. The two forward-looking figures — will a
 * syllabus finish, will a board finish — are both division, and both print the
 * division beside them. A model over one class and sixteen finished tasks would
 * be a confident number with nothing behind it.
 */
export default function Analytics() {
  const { profile } = useAuth()
  const [pace, setPace] = useState<ClassPace[] | null>(null)
  const [gaps, setGaps] = useState<ClassGap[]>([])
  const [health, setHealth] = useState<ClassHealth[]>([])
  const [unmeasured, setUnmeasured] = useState<ClassUnmeasured[]>([])
  const [members, setMembers] = useState<Load[]>([])
  const [burns, setBurns] = useState<BoardBurn[]>([])
  const [tasks, setTasks] = useState<TaskState[]>([])
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope>(EMPTY_SCOPE)
  const [openTask, setOpenTask] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [p, u, g, h, m, b, t] = await Promise.all([
        classPace(),
        classesUnmeasured(),
        classGaps(),
        classHealth(),
        memberLoad(),
        boardBurn(),
        taskStates(),
      ])
      setPace(p)
      setUnmeasured(u)
      setGaps(g)
      setHealth(h)
      setMembers(m)
      setBurns(b)
      setTasks(t)
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the analytics.'))
      setPace([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Everything narrows off one scope, so the page never describes two subjects.
  const shownTasks = useMemo(
    () =>
      tasks
        .filter((t) => (scope.classId ? t.class_id === scope.classId : true))
        .filter((t) => (scope.projectId ? t.project_id === scope.projectId : true))
        .filter((t) => (scope.boardId ? t.board_id === scope.boardId : true))
        .filter((t) => (scope.studentId ? t.assignee_ids.includes(scope.studentId) : true))
        .filter((t) => (scope.taskId ? t.task_id === scope.taskId : true)),
    [tasks, scope],
  )

  const shownBurns = useMemo(() => {
    const boards = new Set(shownTasks.map((t) => t.board_id))
    return burns
      .filter((b) => (scope.classId ? b.class_id === scope.classId : true))
      .filter((b) => (scope.projectId ? b.project_id === scope.projectId : true))
      .filter((b) => (scope.boardId ? b.board_id === scope.boardId : true))
      // Narrowing to a person or a task means the boards they are not on stop
      // being part of the answer.
      .filter((b) => (scope.studentId || scope.taskId ? boards.has(b.board_id) : true))
      .sort((a, b) => Number(a.done_pct) - Number(b.done_pct))
  }, [burns, scope, shownTasks])

  const shownMembers = useMemo(
    () =>
      members
        .filter((m) => (scope.classId ? m.class_id === scope.classId : true))
        .filter((m) => (scope.projectId ? m.project_id === scope.projectId : true))
        .filter((m) => (scope.boardId ? m.board_id === scope.boardId : true))
        .filter((m) => (scope.studentId ? m.student_id === scope.studentId : true)),
    [members, scope],
  )

  // The syllabus and its gaps belong to a class, so they answer only the top
  // two levels — a group has no pace of its own against a syllabus.
  const shownPace = useMemo(
    () => (pace ?? []).filter((p) => (scope.classId ? p.class_id === scope.classId : true)),
    [pace, scope.classId],
  )
  const shownGaps = useMemo(
    () => gaps.filter((g) => (scope.classId ? g.class_id === scope.classId : true)),
    [gaps, scope.classId],
  )
  const shownUnmeasured = useMemo(
    () => unmeasured.filter((c) => (scope.classId ? c.class_id === scope.classId : true)),
    [unmeasured, scope.classId],
  )
  const narrowedBelowClass = Boolean(
    scope.projectId || scope.boardId || scope.studentId || scope.taskId,
  )

  const totals = useMemo(() => {
    // Counted off the boards in view rather than class_health, so the numbers
    // follow the filter down instead of stopping at the class.
    const base = { boards: 0, empty: 0, submitted: 0, accepted: 0, returned: 0,
                   late: 0, unclaimed: 0, tasks: 0, done: 0 }
    if (!narrowedBelowClass) {
      const rows = health.filter((h) => (scope.classId ? h.class_id === scope.classId : true))
      return rows.reduce(
        (a, h) => ({
          boards: a.boards + h.boards,
          empty: a.empty + h.boards_empty,
          submitted: a.submitted + h.boards_submitted,
          accepted: a.accepted + h.boards_accepted,
          returned: a.returned + h.boards_returned,
          late: a.late + h.late_tasks,
          unclaimed: a.unclaimed + h.tasks_unclaimed,
          tasks: a.tasks + h.tasks,
          done: a.done + h.tasks_done,
        }),
        base,
      )
    }
    return shownBurns.reduce(
      (a, b) => ({
        boards: a.boards + 1,
        empty: a.empty + (b.task_count === 0 ? 1 : 0),
        submitted: a.submitted + (b.submitted_at ? 1 : 0),
        accepted: a.accepted + (b.result_verdict === 'accepted' ? 1 : 0),
        returned: a.returned + (b.result_verdict === 'returned' ? 1 : 0),
        late: a.late + b.late_count,
        unclaimed: a.unclaimed + b.unclaimed_count,
        tasks: a.tasks + b.task_count,
        done: a.done + b.done_count,
      }),
      base,
    )
  }, [health, shownBurns, scope.classId, narrowedBelowClass])

  if (pace === null) {
    return (
      <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Working it out…
      </div>
    )
  }

  const atRisk = shownBurns.filter(
    (b) => !b.submitted_at && b.task_count > 0 && b.done_count < b.task_count,
  )

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">Teaching</p>
        <h1 className="mt-1 text-[30px] leading-tight">Analytics</h1>
        <p className="mt-2 max-w-[66ch] text-[14.5px] text-muted">
          Narrow to a class, a project, a group, one student or a single task. Every figure
          is counted from what has happened; the two projections are arithmetic and show
          their working.
        </p>
      </header>

      {error && <Alert tone="error">{error}</Alert>}

      <FilterChain
        scope={scope}
        onChange={setScope}
        classes={health}
        burns={burns}
        members={members}
        tasks={tasks}
      />

      {health.length === 0 ? (
        <EmptyState
          icon="chart"
          title="Nothing to measure yet"
          body="Create a class, set its term dates and give it a syllabus, and its pace shows up here."
        />
      ) : (
        <>
          {/* A syllabus belongs to a class, so it stops mattering once the
              question is about one group or one person. */}
          {!narrowedBelowClass && (
            <>
              {/* A syllabus gap list is only true for a class that has one. With
                  nothing measurable in view, "every assessed week has work
                  against it" would be an answer to a question nobody can ask. */}
              {shownPace.length > 0 && (
                <>
                  <section className="space-y-3">
                    {shownPace.map((p) => (
                      <PaceCard key={p.class_id} pace={p} />
                    ))}
                  </section>

                  <section className="space-y-3">
                    <h2 className="text-[17px]">Weeks with nothing set</h2>
                    <GapList gaps={shownGaps} />
                  </section>
                </>
              )}

              <UnmeasuredList rows={shownUnmeasured} />
            </>
          )}

          <section className="space-y-3">
            <h2 className="text-[17px]">Where the work stands</h2>
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
              <Tile value={`${totals.done}/${totals.tasks}`} label="tasks done" />
              <Tile value={totals.boards} label="boards" />
              <Tile value={totals.submitted} label="handed in" />
              <Tile value={totals.accepted} label="accepted" />
              <Tile value={totals.returned} label="returned" />
              <Tile value={totals.late} label="handed in late" tone="warn" />
            </div>
            {(totals.empty > 0 || totals.unclaimed > 0) && (
              <p className="flex items-start gap-2 text-[13px] text-muted">
                <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-amber-500" />
                {totals.empty > 0 &&
                  `${totals.empty} board${totals.empty === 1 ? '' : 's'} with no tasks`}
                {totals.empty > 0 && totals.unclaimed > 0 && ' · '}
                {totals.unclaimed > 0 &&
                  `${totals.unclaimed} task${totals.unclaimed === 1 ? '' : 's'} nobody has claimed`}
              </p>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px]">Will the work land</h2>
            <p className="max-w-[66ch] text-[13.5px] text-muted">
              Tasks finished per day since each board started, against the days it has left.
              Slowest first.
            </p>
            {atRisk.length === 0 ? (
              <EmptyState
                icon="check"
                title="Nothing outstanding"
                body="Every board in view is finished, handed in, or has no tasks on it yet."
              />
            ) : (
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {atRisk.map((b) => (
                  <BurnCard key={b.board_id} burn={b} />
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px]">Who is carrying the work</h2>
            <p className="max-w-[66ch] text-[13.5px] text-muted">
              Effort, not marks. A group at eighty per cent looks the same whether everyone
              did a share or one person did all of it.
            </p>
            <MemberLoad rows={shownMembers} />
          </section>

          {/* The leaf. Only worth the room once the question is narrow. */}
          {(scope.boardId || scope.studentId || scope.taskId) && (
            <section className="space-y-3">
              <h2 className="text-[17px]">
                Tasks
                <span className="ml-2 font-mono text-[13px] text-faint">
                  {shownTasks.length}
                </span>
              </h2>
              <ul className="space-y-1.5">
                {shownTasks.map((t) => {
                  const due = dueSoonLabel(t.due_at)
                  return (
                    <li key={t.task_id}>
                      <button
                        type="button"
                        onClick={() => setOpenTask(t.task_id)}
                        className="surface flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line px-3.5 py-2.5 text-left transition-colors hover:border-line-strong"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] text-ink">{t.title}</span>
                          <span className="block truncate text-[12px] text-faint">
                            {t.group_name ?? t.board_student_name} · {t.project_title}
                            {t.assignee_names && ` · ${t.assignee_names}`}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-md surface-sunken px-2 py-0.5 font-mono text-[11px] text-muted">
                          {taskStatusLabel(t.status)}
                        </span>
                        {t.late && (
                          <span className="shrink-0 rounded-md bg-red-500/15 px-1.5 py-0.5 font-mono text-[10.5px] text-red-700 dark:text-red-300">
                            late
                          </span>
                        )}
                        {due && !t.late && (
                          <span className="shrink-0 font-mono text-[11.5px] text-faint">
                            {due}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </>
      )}

      <TaskDetailModal
        taskId={openTask}
        onClose={() => setOpenTask(null)}
        viewerId={profile?.id}
        role="professor"
        boardWeight={0}
        onChanged={load}
      />
    </div>
  )
}
