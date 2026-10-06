import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLive } from '../../hooks/useLive'
import { useTaskBoard } from '../../hooks/useTaskBoard'
import { listSprints } from '../../lib/api/sprints'
import {
  groupByOrigin,
  listMemberProgress,
  listProjectTaskRows,
} from '../../lib/api/tasks'
import type { ProfessorTaskGroup, ProjectTaskRow } from '../../lib/api/tasks'
import { authErrorMessage } from '../../lib/authError'
import { boardOwnerName, isProjectLocked } from '../../lib/types'
import { taskLayout, withWork, workSection } from '../../lib/work/nav'
import type { TaskLayout, WorkSection } from '../../lib/work/nav'
import { applyScope, readScope } from '../../lib/work/scope'
import type { TaskScope } from '../../lib/work/scope'
import type { Sprint } from '../../lib/work/types'
import type { BoardSummary, MemberProgress as MemberRow, ProjectSummary, TeachingViewRole } from '../../lib/types'
import { EMPTY_TASK_FILTERS, applyTaskFilters, narrowsTasks } from './taskFilterState'
import type { TaskFilterState } from './taskFilterState'

/**
 * Everything the tasks tab knows, in one place.
 *
 * The professor's view and the student's view of a project share almost all of
 * their state — the same boards, the same rows, the same filters, the same
 * selected board — and differ almost entirely in what they render. Keeping the
 * state here lets each view be read on its own without scrolling past the
 * other's markup.
 *
 * Nothing here renders. If something in this file starts returning JSX, it
 * belongs in a component instead.
 */
export function useProjectTasks({
  project, role,
}: {
  project: ProjectSummary
  role: TeachingViewRole
}) {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null)
  const [rows, setRows] = useState<ProjectTaskRow[]>([])
  const [mine, setMine] = useState<ProfessorTaskGroup[]>([])
  const [progress, setProgress] = useState<MemberRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [params, setParams] = useSearchParams()
  // `?board=` arrives from a link that means one group's work, so it opens
  // with that board chosen rather than every board at once.
  const [filters, setFilters] = useState<TaskFilterState>(() => ({
    ...EMPTY_TASK_FILTERS,
    board: role === 'professor' ? (params.get('board') ?? '') : '',
  }))

  const isProfessor = role === 'professor'
  // A passed deadline still takes work — only the professor closing it stops
  // the board, so this is the one thing the UI gates on.
  const locked = isProjectLocked(project)
  // An individual project hands every student their own board.
  const solo = project.audience === 'individual'

  const loadBoards = useCallback(async () => {
    try {
      // One pass over the project: the summary and the list read the same rows
      // the board does, so the three views can never disagree.
      const { boards: found, rows: all } = await listProjectTaskRows(project.id)
      setBoards(found)
      setRows(all)
      if (isProfessor) setMine(groupByOrigin(all))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the tasks.'))
      setBoards([])
      setRows([])
    }
  }, [project.id, isProfessor])

  useEffect(() => {
    void loadBoards()
  }, [loadBoards])

  // Picking a board is one idea, not two: it drives the board, the summary, and
  // the list together, so the tiles and the filter can never disagree. Keyed on
  // the board rather than the group, because an individual project has none —
  // which used to make every tile on one impossible to select.
  const active = isProfessor
    ? ((boards ?? []).find((b) => b.id === filters.board) ?? null)
    : (boards?.[0] ?? null)

  const { tasks, members, loading: boardLoading, reload } = useTaskBoard(active)

  // Member percentages are derived in the database, so they follow the board
  // rather than being recomputed here from a stale copy of the tasks.
  const activeId = active?.id
  const activeGroupId = active?.group_id
  const loadProgress = useCallback(async () => {
    if (!activeId) return setProgress([])
    try {
      setProgress(await listMemberProgress(activeId, activeGroupId))
    } catch {
      setProgress([])
    }
  }, [activeId, activeGroupId])

  useEffect(() => {
    void loadProgress()
  }, [loadProgress, tasks])

  // Sprints belong to one board, so they follow the board in view.
  const [sprints, setSprints] = useState<Sprint[]>([])
  const loadSprints = useCallback(async () => {
    if (!activeId) return setSprints([])
    try {
      setSprints(await listSprints({ kind: 'class', boardId: activeId }))
    } catch {
      setSprints([])
    }
  }, [activeId])
  useEffect(() => {
    void loadSprints()
  }, [loadSprints])
  useLive(loadSprints, ['board_sprints'], { enabled: Boolean(activeId) })

  const refresh = useCallback(async () => {
    await Promise.all([reload(), loadBoards(), loadProgress(), loadSprints()])
  }, [reload, loadBoards, loadProgress, loadSprints])

  // A student's views cover their own board; a professor's cover the project,
  // narrowed by the group filter.
  const scope = useMemo(
    () => (isProfessor ? rows : rows.filter((t) => t.board_id === active?.id)),
    [rows, isProfessor, active?.id],
  )
  // With a board in view, Tasks follows the chosen sprint too.
  const sprintScope: TaskScope = activeId ? readScope(params.get('scope'), sprints) : 'all'
  const shown = useMemo(
    () => applyScope(applyTaskFilters(scope, filters), sprintScope, sprints),
    [scope, filters, sprintScope, sprints],
  )
  // The board reads its own live tasks, which follow realtime; the rows above
  // only refresh on a reload. So scope the live tasks directly, and fall back
  // to matching the rows only while a search or filter needs them.
  const boardTasks = useMemo(
    () =>
      narrowsTasks(filters)
        ? tasks.filter((task) => shown.some((r) => r.id === task.id))
        : applyScope(tasks, sprintScope, sprints),
    [tasks, filters, shown, sprintScope, sprints],
  )

  // Rows carry a board, not a name; the boards carry the name.
  const ownerByBoard = useMemo(() => {
    const map = new Map<string, string>()
    for (const b of boards ?? []) map.set(b.id, boardOwnerName(b))
    return map
  }, [boards])
  const ownerFor = useCallback(
    (row: ProjectTaskRow) => ownerByBoard.get(row.board_id) ?? '—',
    [ownerByBoard],
  )

  const weightByBoard = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of rows) map.set(t.board_id, (map.get(t.board_id) ?? 0) + t.weight)
    return map
  }, [rows])

  const openTask = params.get('task')
  // Where you are inside Work lives in the address, so Submissions' and
  // Reassignments' links to a board or a task land on Tasks.
  const section = workSection(params, isProfessor ? 'summary' : 'tasks')
  const view = taskLayout(params)
  const setSection = useCallback(
    (s: WorkSection) => setParams(withWork(params, { section: s })),
    [params, setParams],
  )
  const setView = useCallback(
    (l: TaskLayout) => setParams(withWork(params, { layout: l }), { replace: true }),
    [params, setParams],
  )
  const setSprintScope = useCallback(
    (s: TaskScope) => setParams(withWork(params, { scope: s }), { replace: true }),
    [params, setParams],
  )
  const showTask = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params)
      if (id) {
        next.set('task', id)
        // `task` alone reads as Tasks; keep the section the task was opened from.
        next.set('work', section)
      } else next.delete('task')
      setParams(next, { replace: !id })
    },
    [params, setParams, section],
  )

  const showBoard = useCallback((boardId: string | null) => {
    setFilters((f) => ({ ...f, board: boardId ?? '' }))
  }, [])

  return {
    boards,
    rows,
    mine,
    progress,
    error,
    filters,
    setFilters,
    section,
    setSection,
    view,
    setView,
    isProfessor,
    locked,
    solo,
    active,
    tasks,
    boardTasks,
    members,
    boardLoading,
    refresh,
    scope,
    shown,
    ownerFor,
    weightByBoard,
    openTask,
    showTask,
    showBoard,
    sprints,
    sprintScope,
    setSprintScope,
  }
}

export type ProjectTasks = ReturnType<typeof useProjectTasks>
