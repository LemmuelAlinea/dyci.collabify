import { useCallback, useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Alert } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { EmptyState } from '../ui/Tabs'
import { useToast } from '../ui/Toast'
import { BoardProgress } from './BoardProgress'
import { FanOutForm } from './FanOutForm'
import { GroupProgressTable } from './GroupProgressTable'
import { MemberProgress } from './MemberProgress'
import { TaskBoard } from './TaskBoard'
import { useTaskBoard } from '../../hooks/useTaskBoard'
import {
  deleteProfessorTask,
  groupByOrigin,
  listBoards,
  listMemberProgress,
  listProjectTasks,
} from '../../lib/api/tasks'
import type { ProfessorTaskGroup } from '../../lib/api/tasks'
import { authErrorMessage } from '../../lib/authError'
import { isReleased } from '../../lib/types'
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
  const [open, setOpen] = useState<BoardSummary | null>(null)
  const [setTaskOpen, setSetTaskOpen] = useState(false)
  const [editingOrigin, setEditingOrigin] = useState<ProfessorTaskGroup | null>(null)
  const [deletingOrigin, setDeletingOrigin] = useState<ProfessorTaskGroup | null>(null)
  const [mine, setMine] = useState<ProfessorTaskGroup[]>([])
  const [progress, setProgress] = useState<MemberRow[]>([])

  const isProfessor = role === 'professor'

  const loadBoards = useCallback(async () => {
    try {
      if (isProfessor) {
        const { boards: rows, tasks } = await listProjectTasks(project.id)
        setBoards(rows)
        setMine(groupByOrigin(tasks))
      } else {
        setBoards(await listBoards(project.id))
      }
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the tasks.'))
      setBoards([])
    }
  }, [project.id, isProfessor])

  useEffect(() => {
    void loadBoards()
  }, [loadBoards])

  // RLS already narrows a student to the board they work on, so the first row
  // is theirs. A professor sees them all and picks one.
  const active = isProfessor ? open : (boards?.[0] ?? null)

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
        {active ? (
          boardLoading ? (
            <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
              <Spinner size={16} />
              Loading your board…
            </div>
          ) : (
            <>
              <BoardProgress board={active} />
              <MemberProgress
                rows={progress}
                viewerId={viewerId}
                title={active.group_id ? 'You and your group' : 'Your progress'}
              />
              <TaskBoard
                board={active}
                tasks={tasks}
                members={members}
                viewerId={viewerId}
                role={role}
                canWork
                onChanged={refresh}
              />
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

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[16px]">What you set</h3>
            <p className="mt-0.5 text-[13px] text-muted">
              Handed to the groups. They decide who does it.
            </p>
          </div>
          <Button size="sm" className="!rounded-lg" onClick={() => setSetTaskOpen(true)}>
            <Icon name="plus" size={15} />
            Set a task
          </Button>
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
        <h3 className="text-[16px]">Where the groups are</h3>
        <GroupProgressTable boards={boards} onOpen={setOpen} />
      </section>

      {active && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[16px]">{active.group_name ?? 'One student'}</h3>
            <Button variant="ghost" size="sm" onClick={() => setOpen(null)}>
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
              <BoardProgress board={active} />
              <MemberProgress rows={progress} title="Who is carrying what" />
              <TaskBoard
                board={active}
                tasks={tasks}
                members={members}
                viewerId={viewerId}
                role={role}
                canWork={false}
                onChanged={refresh}
              />
            </>
          )}
        </section>
      )}

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
