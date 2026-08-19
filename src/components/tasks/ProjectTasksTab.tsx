import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Alert } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { EmptyState } from '../ui/Tabs'
import { useToast } from '../ui/Toast'
import { BoardProgress } from './BoardProgress'
import { FanOutForm } from './FanOutForm'
import { GenerateTasksModal } from './GenerateTasksModal'
import { GroupProgressTable } from './GroupProgressTable'
import { MemberProgress } from './MemberProgress'
import { BoardVerdict } from './BoardVerdict'
import { SubmitProject } from './SubmitProject'
import { TaskBoard } from './TaskBoard'
import { TaskDetailModal } from './detail/TaskDetailModal'
import { EMPTY_TASK_FILTERS, TaskFilters, applyTaskFilters } from './TaskFilters'
import type { TaskFilterState } from './TaskFilters'
import { TaskList } from './TaskList'
import { TaskSummary } from './TaskSummary'
import { useTaskBoard } from '../../hooks/useTaskBoard'
import {
  deleteProfessorTask,
  groupByOrigin,
  listMemberProgress,
  listProjectTaskRows,
} from '../../lib/api/tasks'
import type { ProfessorTaskGroup, ProjectTaskRow } from '../../lib/api/tasks'
import { authErrorMessage } from '../../lib/authError'
import { boardOwnerName, isBoardSubmitted, isProjectLocked, isReleased } from '../../lib/types'
import type {
  BoardSummary,
  MemberProgress as MemberRow,
  ProjectSummary,
  Role,
} from '../../lib/types'

/**
 * Tasks inside one project. A student sees their own board; a professor sees
 * what they set, where every group stands, and can open any board read-only.
 */
export function ProjectTasksTab({
  project,
  role,
  viewerId,
}: {
  project: ProjectSummary
  role: Role
  viewerId: string | undefined
}) {
  const { show } = useToast()
  const [boards, setBoards] = useState<BoardSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [setTaskOpen, setSetTaskOpen] = useState(false)
  const [editingOrigin, setEditingOrigin] = useState<ProfessorTaskGroup | null>(null)
  const [deletingOrigin, setDeletingOrigin] = useState<ProfessorTaskGroup | null>(null)
  const [mine, setMine] = useState<ProfessorTaskGroup[]>([])
  const [progress, setProgress] = useState<MemberRow[]>([])
  const [aiOpen, setAiOpen] = useState(false)
  const [rows, setRows] = useState<ProjectTaskRow[]>([])
  const [view, setView] = useState<'summary' | 'board' | 'list'>(
    role === 'professor' ? 'summary' : 'board',
  )
  const [filters, setFilters] = useState<TaskFilterState>(EMPTY_TASK_FILTERS)
  const [params, setParams] = useSearchParams()
  const openTask = params.get('task')

  const isProfessor = role === 'professor'
  // A passed deadline still takes work — only the professor closing it stops
  // the board, so this is the one thing the UI gates on.
  const locked = isProjectLocked(project)

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

  function showBoard(boardId: string | null) {
    setFilters((f) => ({ ...f, board: boardId ?? '' }))
  }

  // An individual project hands every student their own board.
  const solo = project.audience === 'individual'

  const {
    tasks,
    members,
    loading: boardLoading,
    reload,
  } = useTaskBoard(active)

  // Member percentages are derived in the database, so they follow the board
  // rather than being recomputed here from a stale copy of the tasks.
  const activeId = active?.id
  const loadProgress = useCallback(async () => {
    if (!activeId) return setProgress([])
    try {
      setProgress(await listMemberProgress(activeId))
    } catch {
      setProgress([])
    }
  }, [activeId])

  useEffect(() => {
    void loadProgress()
  }, [loadProgress, tasks])

  const refresh = useCallback(async () => {
    await Promise.all([reload(), loadBoards(), loadProgress()])
  }, [reload, loadBoards, loadProgress])

  // A student's views cover their own board; a professor's cover the project,
  // narrowed by the group filter.
  const scope = useMemo(
    () => (isProfessor ? rows : rows.filter((t) => t.board_id === active?.id)),
    [rows, isProfessor, active?.id],
  )
  const shown = useMemo(() => applyTaskFilters(scope, filters), [scope, filters])
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

  function showTask(id: string | null) {
    const next = new URLSearchParams(params)
    if (id) next.set('task', id)
    else next.delete('task')
    setParams(next, { replace: !id })
  }

  const viewSwitch = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex gap-1 rounded-lg surface-sunken p-0.5">
        {(['summary', 'board', 'list'] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] capitalize transition-colors ${
              view === v
                ? 'surface font-medium text-ink shadow-card'
                : 'text-muted hover:text-ink'
            }`}
          >
            <Icon name={v === 'summary' ? 'chart' : v === 'board' ? 'kanban' : 'board'} size={15} />
            {v}
          </button>
        ))}
      </div>
      <p className="text-[12.5px] text-faint">
        {shown.length === scope.length
          ? `${scope.length} ${scope.length === 1 ? 'task' : 'tasks'}`
          : `${shown.length} of ${scope.length} tasks`}
      </p>
    </div>
  )

  const filterBar =
    scope.length > 0 ? (
      <TaskFilters
        value={filters}
        onChange={setFilters}
        rows={scope}
        boards={boards ?? []}
        showBoards={isProfessor}
      />
    ) : null

  const detailModal = (
    <TaskDetailModal
      taskId={openTask}
      onClose={() => showTask(null)}
      viewerId={viewerId}
      role={role}
      boardWeight={
        weightByBoard.get(rows.find((t) => t.id === openTask)?.board_id ?? '') ?? 0
      }
      locked={(locked || isBoardSubmitted(active)) && !isProfessor}
      onChanged={refresh}
    />
  )

  const lockedNotice = locked ? (
    <Alert tone="info">
      {isProfessor
        ? 'This project is closed. Students can no longer change their tasks — reopen it from the project header to let them back in.'
        : 'This project is closed, so your tasks can no longer change. You can still read the board and comment. Ask your professor to reopen it if you need to finish something.'}
    </Alert>
  ) : null

  if (boards === null) {
    return (
      <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading tasks…
      </div>
    )
  }

  if (!isProfessor && !isReleased(project)) {
    return (
      <EmptyState
        icon="clock"
        title="Not open yet"
        body="This project has not been released, so there is nothing to plan against."
      />
    )
  }

  if (boards.length === 0) {
    return (
      <EmptyState
        icon="users"
        title="No boards yet"
        body={
          isProfessor
            ? 'A board appears for each group once the project reaches them. Check the group set on this project.'
            : 'You are not in a group for this project yet, so there is nowhere to plan your work.'
        }
      />
    )
  }

  /* -------------------------------------------------------------- student */

  if (!isProfessor) {
    return (
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        {lockedNotice}
        <GenerateTasksModal
          open={aiOpen}
          onClose={() => setAiOpen(false)}
          project={project}
          board={active}
          boards={boards}
          role={role}
          viewerId={viewerId}
          onSaved={async (message) => {
            show(message)
            await refresh()
          }}
        />

        {active ? (
          boardLoading ? (
            <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
              <Spinner size={16} />
              Loading your board…
            </div>
          ) : (
            <>
              <BoardVerdict board={active} role={role} onChanged={refresh} />
              <SubmitProject board={active} locked={locked} onChanged={refresh} />
              <BoardProgress board={active} />
              <MemberProgress
                rows={progress}
                viewerId={viewerId}
                dense
                title={active.group_id ? 'Your group' : 'Your progress'}
              />
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  className="!rounded-lg"
                  onClick={() => setAiOpen(true)}
                >
                  <Icon name="spark" size={15} />
                  Draft tasks with AI
                </Button>
              </div>

              {viewSwitch}
              {filterBar}

              {view === 'summary' && <TaskSummary rows={shown} />}
              {view === 'list' && (
                <TaskList
                  rows={shown}
                  boardWeight={weightByBoard}
                  showOwner={false}
                  ownerLabel=""
                  ownerFor={ownerFor}
                  onOpen={showTask}
                />
              )}
              {view === 'board' && (
                <TaskBoard
                  board={active}
                  tasks={
                    filters === EMPTY_TASK_FILTERS
                      ? tasks
                      : tasks.filter((t) => shown.some((r) => r.id === t.id))
                  }
                  members={members}
                  progress={progress}
                  viewerId={viewerId}
                  role={role}
                  canWork
                  onChanged={refresh}
                />
              )}
              {view !== 'board' && detailModal}
            </>
          )
        ) : (
          <EmptyState
            icon="users"
            title="No board for you here"
            body="You are not in a group for this project yet."
          />
        )}
      </div>
    )
  }

  /* ------------------------------------------------------------ professor */

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}
      {lockedNotice}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[16px]">What you set</h3>
            <p className="mt-0.5 text-[13px] text-muted">
              Handed to the groups. They decide who does it.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="!rounded-lg"
              onClick={() => setAiOpen(true)}
            >
              <Icon name="spark" size={15} />
              Draft with AI
            </Button>
            <Button size="sm" className="!rounded-lg" onClick={() => setSetTaskOpen(true)}>
              <Icon name="plus" size={15} />
              Set a task
            </Button>
          </div>
        </div>

        {mine.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[13.5px] text-muted">
            You have set none. A group can still break the project down themselves.
          </p>
        ) : (
          <ul className="space-y-2">
            {mine.map((t) => (
              <li
                key={t.origin_id}
                className="surface flex flex-wrap items-center gap-3 rounded-xl border border-line px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-medium text-ink">{t.title}</p>
                  <p className="mt-0.5 text-[12.5px] text-faint">
                    {t.boards} {t.boards === 1 ? 'group' : 'groups'} · {t.started} started ·{' '}
                    {t.done} done
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingOrigin(t)}
                  aria-label={`Edit ${t.title}`}
                  className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
                >
                  <Icon name="edit" size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setDeletingOrigin(t)}
                  aria-label={`Withdraw ${t.title}`}
                  className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/12 dark:hover:text-red-400"
                >
                  <Icon name="trash" size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-[16px]">
          {solo ? 'Where the students are' : 'Where the groups are'}
        </h3>
        <GroupProgressTable
          boards={boards}
          activeId={active?.id}
          solo={solo}
          onOpen={(b) => showBoard(b.id === active?.id ? null : b.id)}
        />
      </section>

      <section className="space-y-3">
        {viewSwitch}
        {filterBar}

        {view === 'summary' && <TaskSummary rows={shown} />}
        {view === 'list' && (
          <TaskList
            rows={shown}
            boardWeight={weightByBoard}
            showOwner
            ownerLabel={solo ? 'Student' : 'Group'}
            ownerFor={ownerFor}
            onOpen={showTask}
          />
        )}
        {view === 'board' && !active && (
          <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-[13.5px] text-muted">
            {solo
              ? 'Open a student above to see their board, or switch to the list to see everyone at once.'
              : 'Open a group above to see its board, or switch to the list to see every group at once.'}
          </p>
        )}
        {view !== 'board' && detailModal}
      </section>

      {active && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[16px]">{boardOwnerName(active)}</h3>
            <Button variant="ghost" size="sm" onClick={() => showBoard(null)}>
              <Icon name="x" size={15} />
              Close
            </Button>
          </div>
          {boardLoading ? (
            <div className="flex items-center gap-2.5 py-8 text-[14px] text-muted">
              <Spinner size={16} />
              Loading that board…
            </div>
          ) : (
            <>
              <BoardVerdict board={active} role={role} onChanged={refresh} />
              <BoardProgress board={active} />
              <MemberProgress rows={progress} title="Who is carrying what" />
              <TaskBoard
                board={active}
                tasks={tasks}
                members={members}
                progress={progress}
                viewerId={viewerId}
                role={role}
                canWork={false}
                onChanged={refresh}
              />
            </>
          )}
        </section>
      )}

      <GenerateTasksModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        project={project}
        board={active}
        boards={boards}
        role={role}
        viewerId={viewerId}
        onSaved={async (message) => {
          show(message)
          await refresh()
        }}
      />

      <FanOutForm
        open={setTaskOpen || Boolean(editingOrigin)}
        onClose={() => {
          setSetTaskOpen(false)
          setEditingOrigin(null)
        }}
        projectId={project.id}
        boards={boards}
        editing={editingOrigin ?? undefined}
        onSaved={async (message) => {
          show(message)
          await refresh()
        }}
      />

      <ConfirmDialog
        open={Boolean(deletingOrigin)}
        onClose={() => setDeletingOrigin(null)}
        onConfirm={async () => {
          if (!deletingOrigin) return
          const res = await deleteProfessorTask(deletingOrigin.origin_id)
          show(
            res.kept
              ? `Withdrawn from ${res.removed} groups. ${res.kept} had already started and keep theirs.`
              : 'Task withdrawn',
          )
          await refresh()
        }}
        title={`Withdraw ${deletingOrigin?.title ?? ''}?`}
        confirmLabel="Withdraw task"
        body={
          deletingOrigin && deletingOrigin.started > 0 ? (
            <>
              <p>
                {deletingOrigin.started} of {deletingOrigin.boards} groups have started this.
                Their copy stays — you are not deleting work already under way.
              </p>
              <p className="mt-3">The rest lose it.</p>
            </>
          ) : (
            'It disappears from every board that has not started it.'
          )
        }
      />
    </div>
  )
}
