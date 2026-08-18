import { Alert } from '../../ui/Field'
import { Spinner } from '../../ui/Icon'
import { Modal } from '../../ui/Modal'
import { useToast } from '../../ui/Toast'
import { TaskDetailBody } from './TaskDetailBody'
import { useTaskDetail } from '../../../hooks/useTaskDetail'
import { setTaskStatus } from '../../../lib/api/tasks'
import { authErrorMessage } from '../../../lib/authError'
import type { Role, TaskStatus } from '../../../lib/types'

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
  onChanged,
}: {
  taskId: string | null
  onClose: () => void
  viewerId: string | undefined
  role: Role
  boardWeight: number
  onChanged: () => Promise<void> | void
}) {
  const { show } = useToast()
  const { task, comments, events, files, worklog, loading, error, reload } =
    useTaskDetail(taskId)

  async function move(status: TaskStatus) {
    if (!task) return
    try {
      await setTaskStatus(task.id, status)
      await Promise.all([reload(), onChanged()])
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
          onStatus={(status) => void move(status)}
          onChanged={reload}
        />
      )}
    </Modal>
  )
}
