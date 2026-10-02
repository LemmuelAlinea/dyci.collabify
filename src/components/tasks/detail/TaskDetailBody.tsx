import { useState } from 'react'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { Select } from '../../ui/Select'
import { CommentList } from './CommentList'
import { ReassignRequestModal } from './ReassignRequestModal'
import { TaskFileGrid } from './TaskFileGrid'
import { TaskHistory } from './TaskHistory'
import { WorkLogList } from './WorkLogList'
import { useNow } from '../../../hooks/useNow'
import { withdrawReassignment } from '../../../lib/api/reassignments'
import {
  TASK_STATUSES,
  canRequestReassignment,
  formatMinutes,
  fullName,
  isMine,
  taskShare,
  taskStatusLabel,
} from '../../../lib/types'
import type {
  ReassignmentRow,
  TeachingViewRole,
  TaskComment,
  TaskDetail,
  TaskEvent,
  TaskFile,
  TaskStatus,
  WorkLogEntry,
} from '../../../lib/types'

function when(iso: string | null) {
  if (!iso) return 'Not yet'
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * The layout, with no data fetching in it: the modal owns the loading, this
 * owns the arrangement. It follows the work project's task dialog — plain
 * headed sections in two columns — so a task reads the same in a class and in
 * a space. What differs is only what a class allows: the group moves its own
 * work, and a stuck task can be handed to the professor to reassign.
 */
export function TaskDetailBody({
  task,
  comments,
  events,
  files,
  worklog,
  viewerId, role,
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
  role: TeachingViewRole
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
  const share = taskShare(task, boardWeight || task.weight)
  const now = useNow()
  const late = Boolean(task.due_at && task.status !== 'done' && new Date(task.due_at).getTime() < now)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-6">
        <section className="space-y-3 text-[14px]">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-3">
            <div>
              <dt className="text-[12px] text-faint">Stage</dt>
              <dd className="text-ink">{taskStatusLabel(task.status)}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-faint">Worth</dt>
              <dd className="text-ink">
                <span className="font-mono">{share}%</span>
                <span className="ml-1 text-[12px] text-faint">of the project</span>
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-faint">Due</dt>
              <dd className={late ? 'text-danger-600 dark:text-danger-400' : 'text-ink'}>
                {task.due_at ? when(task.due_at) : 'Not set'}
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-faint">Started</dt>
              <dd className="text-ink">{when(task.started_at)}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-faint">Finished</dt>
              <dd className="text-ink">{when(task.done_at)}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-faint">Created by</dt>
              <dd className="text-ink">
                {task.creator_name ?? 'Somebody'}
                {task.author_role === 'professor' && (
                  <span className="ml-1.5 rounded-md bg-navy-50 px-1.5 py-0.5 font-mono text-[11px] text-navy-700 dark:bg-navy-500/18 dark:text-navy-100">
                    SET
                  </span>
                )}
              </dd>
            </div>
          </dl>

          <p className="whitespace-pre-wrap break-words text-ink">
            {task.details || 'No description.'}
          </p>

          {onBoard && yours ? (
            <div className="max-w-[16rem]">
              <Select
                aria-label="Move this task"
                value={task.status}
                onChange={(e) => onStatus(e.target.value as TaskStatus)}
                options={TASK_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
                className="!h-9 !text-[13px]"
              />
            </div>
          ) : (
            <p className="text-[12px] text-muted">
              {!onBoard
                ? 'The group moves its own work.'
                : task.assignees.length === 0
                  ? 'Claim this task to move it.'
                  : 'Only the people on this task move it.'}
            </p>
          )}
        </section>

        <section>
          <h3 className="text-[14px]">Comments</h3>
          <CommentList
            taskId={task.id}
            comments={comments}
            viewerId={viewerId}
            role={role}
            canPost={onBoard}
            onChanged={onChanged}
          />
        </section>
      </div>

      <div className="min-w-0 space-y-6">
        <section>
          <h3 className="text-[14px]">People</h3>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {task.assignees.map(
              (a) =>
                a.profile && (
                  <li
                    key={a.student_id}
                    className="rounded-full surface-sunken px-2.5 py-0.5 text-[12px] text-ink"
                  >
                    {fullName(a.profile)}
                    {a.student_id === viewerId && <span className="text-faint"> (you)</span>}
                  </li>
                ),
            )}
            {task.assignees.length === 0 && (
              <li className="text-[13px] text-faint">Nobody holds this yet.</li>
            )}
          </ul>

          {/* Neglected work is the case this exists for: once a task is
              started nothing else can move it off whoever holds it. */}
          {onBoard &&
            (reassignment ? (
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                Reassignment requested. Waiting on your professor.
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
                    className="font-medium text-navy-600 hover:underline disabled:opacity-60 dark:text-navy-200"
                  >
                    Withdraw it
                  </button>
                )}
              </p>
            ) : (
              viewerCanRequest &&
              canRequestReassignment(task, locked) && (
                <Button variant="outline" size="sm" className="mt-2" onClick={() => setAskOpen(true)}>
                  <Icon name="refresh" size={14} />
                  Request reassignment
                </Button>
              )
            ))}
        </section>

        <TaskFileGrid
          task={task}
          files={files}
          isAssignee={yours}
          locked={locked}
          onChanged={onChanged}
        />

        <section>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[14px]">Time</h3>
            <span className="font-mono text-[12px] text-faint">{formatMinutes(task.logged_minutes)}</span>
          </div>
          <WorkLogList
            task={task}
            entries={worklog}
            viewerId={viewerId}
            isAssignee={yours}
            onChanged={onChanged}
          />
        </section>

        <section>
          <h3 className="text-[14px]">History</h3>
          <TaskHistory events={events} />
        </section>
      </div>

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
