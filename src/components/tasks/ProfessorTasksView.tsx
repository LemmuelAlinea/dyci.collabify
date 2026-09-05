import { useState } from 'react'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Alert } from '../ui/Alert'
import { Icon, Spinner } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { BoardProgress } from './BoardProgress'
import { BoardVerdict } from './BoardVerdict'
import { FanOutForm } from './FanOutForm'
import { GenerateTasksModal } from './GenerateTasksModal'
import { GroupProgressTable } from './GroupProgressTable'
import { MemberProgress } from './MemberProgress'
import { TaskBoard } from './TaskBoard'
import { TaskList } from './TaskList'
import { TaskSummary } from './TaskSummary'
import { TaskDetailModal } from './detail/TaskDetailModal'
import { TaskFilterBar, TaskViewSwitch } from './TaskViewSwitch'
import { deleteProfessorTask } from '../../lib/api/tasks'
import type { ProfessorTaskGroup } from '../../lib/api/tasks'
import { boardOwnerName } from '../../lib/types'
import type { ProjectSummary, Role } from '../../lib/types'
import type { ProjectTasks } from './useProjectTasks'

/** What the professor set, where every group stands, and any one board. */
export function ProfessorTasksView({
  project,
  role,
  viewerId,
  t,
}: {
  project: ProjectSummary
  role: Role
  viewerId: string | undefined
  t: ProjectTasks
}) {
  const { show } = useToast()
  const [aiOpen, setAiOpen] = useState(false)
  const [setTaskOpen, setSetTaskOpen] = useState(false)
  const [editingOrigin, setEditingOrigin] = useState<ProfessorTaskGroup | null>(null)
  const [deletingOrigin, setDeletingOrigin] = useState<ProfessorTaskGroup | null>(null)
  const { active, solo, boards } = t

  return (
    <div className="space-y-6">
      {t.error && <Alert tone="error">{t.error}</Alert>}
      {t.locked && (
        <Alert tone="info">
          This project is closed. Students can no longer change their tasks — reopen it from
          the project header to let them back in.
        </Alert>
      )}

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

        {t.mine.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[13.5px] text-muted">
            You have set none. A group can still break the project down themselves.
          </p>
        ) : (
          <ul className="space-y-2">
            {t.mine.map((task) => (
              <li
                key={task.origin_id}
                className="surface flex flex-wrap items-center gap-3 rounded-xl border border-line px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-medium text-ink">{task.title}</p>
                  <p className="mt-0.5 text-[12.5px] text-faint">
                    {task.boards} {task.boards === 1 ? 'group' : 'groups'} · {task.started}{' '}
                    started · {task.done} done
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingOrigin(task)}
                  aria-label={`Edit ${task.title}`}
                  className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
                >
                  <Icon name="edit" size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setDeletingOrigin(task)}
                  aria-label={`Withdraw ${task.title}`}
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
        <h3 className="text-[16px]">{solo ? 'Where the students are' : 'Where the groups are'}</h3>
        <GroupProgressTable
          boards={boards ?? []}
          activeId={active?.id}
          solo={solo}
          onOpen={(b) => t.showBoard(b.id === active?.id ? null : b.id)}
        />
      </section>

      <section className="space-y-3">
        <TaskViewSwitch
          view={t.view}
          onView={t.setView}
          shown={t.shown.length}
          total={t.scope.length}
        />
        <TaskFilterBar
          filters={t.filters}
          onChange={t.setFilters}
          scope={t.scope}
          boards={boards ?? []}
          showBoards
        />

        {t.view === 'summary' && <TaskSummary rows={t.shown} />}
        {t.view === 'list' && (
          <TaskList
            rows={t.shown}
            boardWeight={t.weightByBoard}
            showOwner
            ownerLabel={solo ? 'Student' : 'Group'}
            ownerFor={t.ownerFor}
            onOpen={t.showTask}
          />
        )}
        {t.view === 'board' && !active && (
          <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-[13.5px] text-muted">
            {solo
              ? 'Open a student above to see their board, or switch to the list to see everyone at once.'
              : 'Open a group above to see its board, or switch to the list to see every group at once.'}
          </p>
        )}
        {t.view !== 'board' && (
          <TaskDetailModal
            taskId={t.openTask}
            onClose={() => t.showTask(null)}
            viewerId={viewerId}
            role={role}
            boardWeight={
              t.weightByBoard.get(t.rows.find((r) => r.id === t.openTask)?.board_id ?? '') ?? 0
            }
            // A professor is never locked out of a task by the project closing.
            locked={false}
            onChanged={t.refresh}
          />
        )}
      </section>

      {active && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[16px]">{boardOwnerName(active)}</h3>
            <Button variant="ghost" size="sm" onClick={() => t.showBoard(null)}>
              <Icon name="x" size={15} />
              Close
            </Button>
          </div>
          {t.boardLoading ? (
            <div className="flex items-center gap-2.5 py-8 text-[14px] text-muted">
              <Spinner size={16} />
              Loading that board…
            </div>
          ) : (
            <>
              <BoardVerdict board={active} role={role} onChanged={t.refresh} />
              <BoardProgress board={active} />
              <MemberProgress rows={t.progress} title="Who is carrying what" />
              <TaskBoard
                board={active}
                tasks={t.tasks}
                members={t.members}
                progress={t.progress}
                viewerId={viewerId}
                role={role}
                canWork={false}
                onChanged={t.refresh}
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
        boards={boards ?? []}
        role={role}
        viewerId={viewerId}
        onSaved={async (message) => {
          show(message)
          await t.refresh()
        }}
      />

      <FanOutForm
        open={setTaskOpen || Boolean(editingOrigin)}
        onClose={() => {
          setSetTaskOpen(false)
          setEditingOrigin(null)
        }}
        projectId={project.id}
        boards={boards ?? []}
        editing={editingOrigin ?? undefined}
        onSaved={async (message) => {
          show(message)
          await t.refresh()
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
          await t.refresh()
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
