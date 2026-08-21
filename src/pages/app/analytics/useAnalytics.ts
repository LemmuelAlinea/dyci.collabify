import { useCallback, useEffect, useMemo, useState } from 'react'
import { EMPTY_SCOPE } from '../../../components/analytics/FilterChain'
import type { Scope } from '../../../components/analytics/FilterChain'
import {
  boardBurn,
  boardDiagnoses,
  classActions,
  classGaps,
  classHealth,
  classPace,
  classParticipation,
  classesUnmeasured,
  deadlinePressure,
  memberLoad,
  taskStates,
} from '../../../lib/api/analytics'
import { authErrorMessage } from '../../../lib/authError'
import { rankActions } from '../../../lib/insight'
import type { ActionRow, BoardDiagnosis, Participation, Pressure } from '../../../lib/insight'
import type {
  BoardBurn,
  ClassGap,
  ClassHealth,
  ClassPace,
  ClassUnmeasured,
  MemberLoad as Load,
  TaskState,
} from '../../../lib/types'

/**
 * Every figure the analytics page reads, narrowed to one scope.
 *
 * The narrowing lives here rather than in the bands so that all four are
 * answering about the same subject at the same moment. A page where the
 * diagnostic band still describes a class the predictive band has moved on from
 * is worse than one that shows less.
 *
 * Three things stay class-level on purpose — the syllabus pace, its gaps, and
 * who is in no group. A group has no pace against a syllabus and no membership
 * of its own, so those bands disappear once the question narrows below a class
 * rather than answering a question nobody asked.
 */
export function useAnalytics() {
  const [pace, setPace] = useState<ClassPace[] | null>(null)
  const [unmeasured, setUnmeasured] = useState<ClassUnmeasured[]>([])
  const [gaps, setGaps] = useState<ClassGap[]>([])
  const [health, setHealth] = useState<ClassHealth[]>([])
  const [members, setMembers] = useState<Load[]>([])
  const [burns, setBurns] = useState<BoardBurn[]>([])
  const [tasks, setTasks] = useState<TaskState[]>([])
  const [diagnoses, setDiagnoses] = useState<BoardDiagnosis[]>([])
  const [people, setPeople] = useState<Participation[]>([])
  const [pressure, setPressure] = useState<Pressure[]>([])
  const [actionRows, setActionRows] = useState<ActionRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope>(EMPTY_SCOPE)

  const load = useCallback(async () => {
    try {
      const [p, u, g, h, m, b, t, d, pa, pr, ac] = await Promise.all([
        classPace(),
        classesUnmeasured(),
        classGaps(),
        classHealth(),
        memberLoad(),
        boardBurn(),
        taskStates(),
        boardDiagnoses(),
        classParticipation(),
        deadlinePressure(),
        classActions(),
      ])
      setPace(p)
      setUnmeasured(u)
      setGaps(g)
      setHealth(h)
      setMembers(m)
      setBurns(b)
      setTasks(t)
      setDiagnoses(d)
      setPeople(pa)
      setPressure(pr)
      setActionRows(ac)
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the analytics.'))
      setPace([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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

  // The boards the narrowed question is actually about. Reused by everything
  // that hangs off a board rather than off a class.
  const boardsInView = useMemo(
    () => new Set(shownTasks.map((t) => t.board_id)),
    [shownTasks],
  )

  const shownBurns = useMemo(
    () =>
      burns
        .filter((b) => (scope.classId ? b.class_id === scope.classId : true))
        .filter((b) => (scope.projectId ? b.project_id === scope.projectId : true))
        .filter((b) => (scope.boardId ? b.board_id === scope.boardId : true))
        // Narrowing to a person or a task means the boards they are not on stop
        // being part of the answer.
        .filter((b) => (scope.studentId || scope.taskId ? boardsInView.has(b.board_id) : true))
        .sort((a, b) => Number(a.done_pct) - Number(b.done_pct)),
    [burns, scope, boardsInView],
  )

  const shownMembers = useMemo(
    () =>
      members
        .filter((m) => (scope.classId ? m.class_id === scope.classId : true))
        .filter((m) => (scope.projectId ? m.project_id === scope.projectId : true))
        .filter((m) => (scope.boardId ? m.board_id === scope.boardId : true))
        .filter((m) => (scope.studentId ? m.student_id === scope.studentId : true)),
    [members, scope],
  )

  const shownDiagnoses = useMemo(
    () =>
      diagnoses
        .filter((d) => (scope.classId ? d.class_id === scope.classId : true))
        .filter((d) => (scope.projectId ? d.project_id === scope.projectId : true))
        .filter((d) => (scope.boardId ? d.board_id === scope.boardId : true))
        .filter((d) =>
          scope.studentId || scope.taskId ? boardsInView.has(d.board_id) : true,
        ),
    [diagnoses, scope, boardsInView],
  )

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
  const shownPeople = useMemo(
    () =>
      people
        .filter((p) => (scope.classId ? p.class_id === scope.classId : true))
        .filter((p) => (scope.studentId ? p.student_id === scope.studentId : true)),
    [people, scope.classId, scope.studentId],
  )
  const shownPressure = useMemo(
    () => pressure.filter((p) => (scope.classId ? p.class_id === scope.classId : true)),
    [pressure, scope.classId],
  )

  const narrowedBelowClass = Boolean(
    scope.projectId || scope.boardId || scope.studentId || scope.taskId,
  )

  const actions = useMemo(() => {
    const rows = actionRows
      .filter((a) => (scope.classId ? a.class_id === scope.classId : true))
      // Below a class, a recommendation about the class itself — a syllabus
      // week, a missing term — is no longer an answer to the question asked.
      .filter((a) => (scope.projectId ? a.project_id === scope.projectId : true))
      .filter((a) => (scope.boardId ? a.board_id === scope.boardId : true))
      .filter((a) =>
        scope.studentId ? a.student_id === scope.studentId || boardsInView.has(a.board_id ?? '') : true,
      )
    return rankActions(rows, shownBurns)
  }, [actionRows, scope, shownBurns, boardsInView])

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

  return {
    loading: pace === null,
    error,
    reload: load,
    scope,
    setScope,
    narrowedBelowClass,
    // Raw, for the filter chain and for anything that must see every class.
    health,
    burns,
    members,
    tasks,
    // Narrowed.
    totals,
    shownPace,
    shownGaps,
    shownUnmeasured,
    shownMembers,
    shownBurns,
    shownTasks,
    shownDiagnoses,
    shownPeople,
    shownPressure,
    actions,
  }
}
