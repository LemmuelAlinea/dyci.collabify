import { Icon } from '../../ui/Icon'
import { Select } from '../../ui/Select'
import { TaskActivity } from './TaskActivity'
import { TaskDetailPanel } from './TaskDetailPanel'
import { TaskFileGrid } from './TaskFileGrid'
import { TASK_STATUSES, isMine, taskShare } from '../../../lib/types'
import type {
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
  onStatus: (status: TaskStatus) => void
  onChanged: () => Promise<void> | void
}) {
  const onBoard = role !== 'professor'
  const yours = viewerId ? isMine(task, viewerId) : false

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-6">
        <section>
          <h3 className="text-[15px] font-semibold text-ink">Description</h3>
          {task.details ? (
            <p className="mt-1.5 text-[14px] leading-relaxed whitespace-pre-wrap text-muted">
              {task.details}
            </p>
          ) : (
            <p className="mt-1.5 text-[13.5px] text-faint">
              No description. {task.status === 'todo' && 'Edit the task to add one.'}
            </p>
          )}
          {yours && (
            <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-amber-700 dark:text-amber-300">
              <Icon name="check" size={13} />
              This one is yours.
            </p>
          )}
        </section>

        <TaskFileGrid
          task={task}
          files={files}
          isAssignee={yours}
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
      <div className="order-first space-y-4 md:order-none">
        <div>
          <label className="block space-y-1.5">
            <span className="text-[12.5px] text-faint">Status</span>
            <Select
              value={task.status}
              disabled={!onBoard}
              onChange={(e) => onStatus(e.target.value as TaskStatus)}
              options={TASK_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
              className="!h-11"
            />
          </label>
          {!onBoard && (
            <p className="mt-1.5 text-[12px] text-faint">The group moves its own work.</p>
          )}
        </div>

        <TaskDetailPanel task={task} share={taskShare(task, boardWeight || task.weight)} />
      </div>
    </div>
  )
}
