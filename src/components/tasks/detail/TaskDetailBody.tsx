import { useState } from 'react'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { Select } from '../../ui/Select'
import { ReassignRequestModal } from './ReassignRequestModal'
import { TaskActivity } from './TaskActivity'
import { TaskDetailPanel } from './TaskDetailPanel'
import { TaskFileGrid } from './TaskFileGrid'
import { withdrawReassignment } from '../../../lib/api/reassignments'
import {
  TASK_STATUSES,
  canRequestReassignment,
  fullName,
  isMine,
  taskShare,
} from '../../../lib/types'
import type {
  ReassignmentRow,
  Role,
  TaskComment,
  TaskDetail,
  TaskEvent,
  TaskFile,
  TaskStatus,
  WorkLogEntry,
} from '../../../lib/types'

/**
 * The layout, with no data fetching in it: the modal owns the loading, this
 * owns the arrangement. Keeping them apart is what lets the layout be measured
 * without a signed-in session behind it.
 */
export function TaskDetailBody({
  task,
  comments,
  events,
  files,
  worklog,
  viewerId,
  role,
  boardWeight,
  locked = false,
  /** The live request on this task, when the viewer is allowed to see one. */
  reassignment,
  viewerCanRequest = false,
  onStatus,
  onChanged,
}: {
  task: TaskDetail
  comments: TaskComment[]
  events: TaskEvent[]
  files: TaskFile[]
  worklog: WorkLogEntry[]
  viewerId: string | undefined
  role: Role
  boardWeight: number
  /** The project is closed, so nothing on the task may change. */
  locked?: boolean
  reassignment?: ReassignmentRow | null
  /** False for a professor: they decide requests, they do not file them. */
  viewerCanRequest?: boolean
  onStatus: (status: TaskStatus) => void
  onChanged: () => Promise<void> | void
}) {
  const [askOpen, setAskOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const onBoard = role !== 'professor'
  // On an individual board the viewer is the owner, so the work is theirs.
  const solo = Boolean(task.group_id === null)
  const yours = solo ? onBoard : viewerId ? isMine(task, viewerId) : false

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_310px]">
      <div className="min-w-0 space-y-4">
        <section className="surface overflow-hidden rounded-card border border-line">
          <header className="flex items-center gap-3 border-b border-line bg-[var(--surface-sunken)] px-4 py-3.5 sm:px-5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-navy-600 text-amber-300 dark:bg-navy-500">
              <Icon name="file" size={16} />
            </span>
            <div>
              <h3>Description</h3>
              <p className="mt-0.5 text-[12px] text-muted">What done looks like.</p>
            </div>
            {yours && (
              <span className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-navy-50 px-2.5 py-1 text-[12px] font-medium text-navy-700 dark:bg-navy-500/20 dark:text-navy-100">
                <Icon name="check" size={13} />
                Assigned to you
              </span>
            )}
          </header>
          <div className="px-4 py-4 sm:px-5">
            {task.details ? (
              <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-muted">
                {task.details}
              </p>
            ) : (
              <p className="text-[13px] text-faint">
                No description. {task.status === 'todo' && 'Edit the task to add one.'}
              </p>
            )}
          </div>
        </section>

        <TaskFileGrid
          task={task}
          files={files}
          isAssignee={yours}
          locked={locked}
          onChanged={onChanged}
        />

        <TaskActivity
          task={task}
          comments={comments}
          events={events}
          worklog={worklog}
          viewerId={viewerId}
          role={role}
          canPost={onBoard}
          isAssignee={yours}
          onChanged={onChanged}
        />
      </div>

      {/* Second in the DOM, which is the desktop order. On a phone it is lifted
          above the thread, which would otherwise push it off the screen. */}
      <aside className="order-first space-y-3 lg:order-none lg:sticky lg:top-0">
        <section className="surface overflow-hidden rounded-card border border-line">
          <header className="border-b border-line bg-[var(--surface-sunken)] px-4 py-3.5">
            <h3>Task status</h3>
            <p className="mt-0.5 text-[12px] text-muted">Keep the board current.</p>
          </header>
          <div className="space-y-3 p-4">
            <label className="block space-y-2">
              <span className="sr-only">Status</span>
            <Select
              value={task.status}
              disabled={!onBoard || !yours}
              onChange={(e) => onStatus(e.target.value as TaskStatus)}
              options={TASK_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
              className="!h-11"
            />
            </label>
            {!onBoard ? (
              <p className="text-[12px] text-faint">The group moves its own work.</p>
            ) : !yours ? (
              <p className="text-[12px] text-faint">
                {task.assignees.length === 0
                  ? 'Claim this task to move it.'
                  : 'Only the people on this task move it.'}
              </p>
            ) : null}
          </div>
        </section>

        {/* Neglected work is the case this exists for: once a task is started
            nothing else can move it off whoever holds it. */}
        {onBoard && (
          <div>
            {reassignment ? (
              <div className="surface rounded-card border border-line px-4 py-3.5">
                <p className="text-[13px] font-medium text-ink">
                  Reassignment requested
                </p>
                <p className="mt-0.5 text-[12px] text-muted">
                  Waiting on your professor.
                </p>
                {reassignment.requested_by === viewerId && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      try {
                        await withdrawReassignment(reassignment.id)
                        await onChanged()
                      } finally {
                        setBusy(false)
                      }
                    }}
                    className="mt-2 text-[12px] font-medium text-navy-600 hover:underline disabled:opacity-60 dark:text-navy-200"
                  >
                    Withdraw it
                  </button>
                )}
              </div>
            ) : (
              viewerCanRequest &&
              canRequestReassignment(task, locked) && (
                <Button
                  variant="outline"
                  size="sm"
                  full
                  onClick={() => setAskOpen(true)}
                >
                  <Icon name="refresh" size={15} />
                  Request reassignment
                </Button>
              )
            )}
          </div>
        )}

        <TaskDetailPanel task={task} share={taskShare(task, boardWeight || task.weight)} />
      </aside>

      <ReassignRequestModal
        open={askOpen}
        onClose={() => setAskOpen(false)}
        taskId={task.id}
        taskTitle={task.title}
        holderName={
          task.assignees.length === 1 && task.assignees[0].profile
            ? fullName(task.assignees[0].profile)
            : null
        }
        mine={yours}
        onDone={onChanged}
      />
    </div>
  )
}
