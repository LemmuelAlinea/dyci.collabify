import { useCallback, useEffect, useState } from 'react'
import { Alert } from '../../ui/Alert'
import { Spinner } from '../../ui/Icon'
import { Modal } from '../../ui/Modal'
import { useToast } from '../../ui/Toast'
import { TaskDetailBody } from './TaskDetailBody'
import { useTaskDetail } from '../../../hooks/useTaskDetail'
import { pendingReassignment } from '../../../lib/api/reassignments'
import { setTaskStatus } from '../../../lib/api/tasks'
import { authErrorMessage } from '../../../lib/authError'
import type { ReassignmentRow, Role, TaskStatus } from '../../../lib/types'

/**
 * One task, whole. Opened from a card or a deep link; the board stays mounted
 * behind it so closing puts you back where you were.
 */
export function TaskDetailModal({
  taskId,
  onClose,
  viewerId,
  role,
  /** Total weight on the board, so the share can be shown honestly. */
  boardWeight,
  /** The project is closed: the board still reads, nothing writes. */
  locked = false,
  onChanged,
}: {
  taskId: string | null
  onClose: () => void
  viewerId: string | undefined
  role: Role
  boardWeight: number
  locked?: boolean
  onChanged: () => Promise<void> | void
}) {
  const { show } = useToast()
  const { task, comments, events, files, worklog, loading, error, reload } =
    useTaskDetail(taskId)
  const [ask, setAsk] = useState<ReassignmentRow | null>(null)

  // RLS decides what comes back: a student sees only their own request, the
  // professor sees any on their classes, and the person it is about sees none.
  const loadAsk = useCallback(async () => {
    if (!taskId) return setAsk(null)
    try {
      setAsk(await pendingReassignment(taskId))
    } catch {
      setAsk(null)
    }
  }, [taskId])

  useEffect(() => {
    void loadAsk()
  }, [loadAsk])

  const refresh = useCallback(async () => {
    await Promise.all([reload(), loadAsk()])
  }, [reload, loadAsk])

  async function move(status: TaskStatus) {
    if (!task) return
    try {
      await setTaskStatus(task.id, status)
      await Promise.all([refresh(), onChanged()])
    } catch (err) {
      show(authErrorMessage(err, 'Could not move that task.'), 'error')
    }
  }

  return (
    <Modal
      open={Boolean(taskId)}
      onClose={onClose}
      title={task?.title ?? 'Task'}
      size="xl"
    >
      {loading && !task ? (
        <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
          <Spinner size={16} />
          Loading the task…
        </div>
      ) : error || !task ? (
        <Alert tone="error">{error ?? 'That task could not be loaded.'}</Alert>
      ) : (
        <TaskDetailBody
          task={task}
          comments={comments}
          events={events}
          files={files}
          worklog={worklog}
          viewerId={viewerId}
          role={role}
          boardWeight={boardWeight}
          locked={locked}
          reassignment={ask}
          viewerCanRequest={role !== 'professor'}
          onStatus={(status) => void move(status)}
          onChanged={async () => {
            await refresh()
            await onChanged()
          }}
        />
      )}
    </Modal>
  )
}
