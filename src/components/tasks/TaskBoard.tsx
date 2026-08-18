import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Alert } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { EmptyState } from '../ui/Tabs'
import { useToast } from '../ui/Toast'
import { TaskCard } from './TaskCard'
import { TaskForm } from './TaskForm'
import { TaskDetailModal } from './detail/TaskDetailModal'
import {
  addTask,
  claimTask,
  deleteTask,
  releaseTask,
  setTaskStatus,
  updateTask,
} from '../../lib/api/tasks'
import type { TaskInput } from '../../lib/api/tasks'
import { authErrorMessage } from '../../lib/authError'
import { boardWeight, TASK_STATUSES, taskShare } from '../../lib/types'
import type {
  BoardSummary,
  GroupMember,
  MemberProgress,
  ProjectTask,
  Role,
  TaskStatus,
} from '../../lib/types'

const COLUMN_TONE: Record<TaskStatus, string> = {
  todo: 'text-muted',
  in_progress: 'text-amber-700 dark:text-amber-300',
  done: 'text-emerald-700 dark:text-emerald-300',
}

export function TaskBoard({
  board,
  tasks,
  members,
  progress,
  viewerId,
  role,
  canWork,
  onChanged,
}: {
  board: BoardSummary
  tasks: ProjectTask[]
  members: GroupMember[]
  /** Who still has room under their share — drives the claim controls. */
  progress: MemberProgress[]
  viewerId: string | undefined
  role: Role
  /** A professor writes the work; only the board's own people move it. */
  canWork: boolean
  onChanged: () => Promise<void> | void
}) {
  const { show } = useToast()
  // The open task lives in the URL, so a task can be linked and reloaded into.
  const [params, setParams] = useSearchParams()
  const openTask = params.get('task')

  function showTask(id: string | null) {
    const next = new URLSearchParams(params)
    if (id) next.set('task', id)
    else next.delete('task')
    setParams(next, { replace: !id })
  }
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<ProjectTask | null>(null)
  const [deleting, setDeleting] = useState<ProjectTask | null>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function run(work: () => Promise<void>, failure: string) {
    try {
      await work()
      await onChanged()
    } catch (err) {
      show(authErrorMessage(err, failure), 'error')
    }
  }

  async function save(input: TaskInput) {
    if (!viewerId) return
    setFormError(null)
    setBusy(true)
    try {
      if (editing) await updateTask(editing.id, input)
      else await addTask(board.id, input, viewerId)
      setAdding(false)
      setEditing(null)
      await onChanged()
    } catch (err) {
      setFormError(authErrorMessage(err, 'Could not save that task.'))
    } finally {
      setBusy(false)
    }
  }

  // A solo board has no unclaimed lane: its owner holds everything on it.
  const solo = Boolean(board.student_id)
  const unclaimed = solo
    ? []
    : tasks.filter((t) => t.assignees.length === 0 && t.status !== 'done')
  // Recomputed on every render: a new task rebalances every other slice.
  const totalWeight = boardWeight(tasks)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13.5px] text-muted">
          <strong className="text-ink">
            {board.done_count} of {board.task_count}
          </strong>{' '}
          done
          {unclaimed.length > 0 && (
            <>
              {' · '}
              <span className="text-amber-700 dark:text-amber-300">
                {unclaimed.length} waiting to be claimed
              </span>
            </>
          )}
        </p>

        {canWork && (
          <Button size="sm" className="!rounded-lg" onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} />
            Add task
          </Button>
        )}
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          icon="check"
          title="No tasks yet"
          body={
            canWork
              ? solo
                ? 'Break the project into the pieces you have to do. Everything here is yours already.'
                : 'Break the project into the pieces your group has to do. Leave one unassigned and anybody can pick it up.'
              : 'This group has not broken the project down yet.'
          }
          action={
            canWork ? (
              <Button className="!rounded-xl" onClick={() => setAdding(true)}>
                Add the first task
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {TASK_STATUSES.map((column) => {
            const inColumn = tasks.filter((t) => t.status === column.value)
            return (
              <section key={column.value} className="space-y-2.5">
                <header className="flex items-baseline justify-between gap-2 border-b border-line pb-2">
                  <h3 className={`text-[13px] font-semibold ${COLUMN_TONE[column.value]}`}>
                    {column.label}
                  </h3>
                  <span className="font-mono text-[11.5px] text-faint">{inColumn.length}</span>
                </header>

                {inColumn.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-faint">
                    Nothing here
                  </p>
                ) : (
                  inColumn.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      share={taskShare(task, totalWeight)}
                      members={members}
                      progress={progress}
                      viewerId={viewerId}
                      role={role}
                      canWork={canWork}
                      onStatus={(status) =>
                        run(() => setTaskStatus(task.id, status), 'Could not move that task.')
                      }
                      onEdit={() => setEditing(task)}
                      onDelete={() => setDeleting(task)}
                      onClaim={(studentId) =>
                        run(
                          () => claimTask(task.id, studentId, viewerId ?? studentId),
                          'Could not take that task.',
                        )
                      }
                      onRelease={(studentId) =>
                        run(
                          () => releaseTask(task.id, studentId),
                          'Could not hand that task back.',
                        )
                      }
                      onOpen={() => showTask(task.id)}
                      counts={task as unknown as { file_count: number; comment_count: number }}
                      solo={solo}
                    />
                  ))
                )}
              </section>
            )
          })}
        </div>
      )}

      {role === 'professor' && tasks.length > 0 && (
        <Alert tone="info">
          You set the work; the group decides who takes it. A task freezes once they start it,
          but you can still edit or reopen anything here.
        </Alert>
      )}

      <Modal
        open={adding || Boolean(editing)}
        onClose={() => {
          setAdding(false)
          setEditing(null)
          setFormError(null)
        }}
        title={editing ? 'Edit task' : 'New task'}
        description={
          editing
            ? 'Anything here can change until somebody starts it.'
            : 'Leave it unassigned and a groupmate can claim it.'
        }
        footer={
          <>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setAdding(false)
                setEditing(null)
              }}
            >
              Cancel
            </Button>
            <Button form="task-form" type="submit" loading={busy} className="!rounded-xl">
              {editing ? 'Save changes' : 'Add task'}
            </Button>
          </>
        }
      >
        <TaskForm
          key={editing?.id ?? 'new'}
          formId="task-form"
          defaults={editing ?? undefined}
          error={formError}
          onSubmit={save}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return
          await deleteTask(deleting.id)
          show('Task deleted')
          await onChanged()
        }}
        title={`Delete ${deleting?.title ?? ''}?`}
        body="The task and its history are removed from this board. This cannot be undone."
        confirmLabel="Delete task"
      />

      <TaskDetailModal
        taskId={openTask}
        onClose={() => showTask(null)}
        viewerId={viewerId}
        role={role}
        boardWeight={totalWeight}
        onChanged={onChanged}
      />
    </div>
  )
}
