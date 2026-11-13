import { useCallback, useEffect, useState } from 'react'
import { Alert } from '../../ui/Alert'
import { Spinner } from '../../ui/Icon'
import { Modal } from '../../ui/Modal'
import { useToast } from '../../ui/Toast'
import { TaskDetailBody } from './TaskDetailBody'
import { useTaskDetail } from '../../../hooks/useTaskDetail'
import { pendingReassignment } from '../../../lib/api/reassignments'
import { getTaskBoardFacts } from '../../../lib/api/taskDetail'
import type { TaskBoardFacts } from '../../../lib/api/taskDetail'
import { getProjectStages } from '../../../lib/api/projects'
import { setTaskStatus } from '../../../lib/api/tasks'
import { stageName, stagesOf } from '../../../lib/stages'
import { authErrorMessage } from '../../../lib/authError'
import type { ReassignmentRow, TeachingViewRole, TaskStatus } from '../../../lib/types'

/**
 * One task, whole. Opened from a card or a deep link; the board stays mounted
 * behind it so closing puts you back where you were.
 */
export function TaskDetailModal({
  taskId,
  onClose,
  viewerId, role,
  /**
   * The host already knows the board is shut. The dialog also reads the
   * task's own board, so a page that does not know still gets it right.
   */
  locked = false,
  onChanged,
}: {
  taskId: string | null
  onClose: () => void
  viewerId: string | undefined
  role: TeachingViewRole
  locked?: boolean
  onChanged: () => Promise<void> | void
}) {
  const { show } = useToast()
  const { task, comments, events, files, worklog, loading, error, reload } =
    useTaskDetail(taskId)
  const [ask, setAsk] = useState<ReassignmentRow | null>(null)
  // The project's own stage names, read beside the task.
  const [stages, setStages] = useState<string[] | null>(null)
  const projectId = task?.project_id

  // The worth and the lock come from the task's own board, never the page's:
  // a page opened from a queue or the calendar has no board of its own loaded.
  // Read again on each reload of the task, so a task added to the board since
  // changes this one's share.
  const [board, setBoard] = useState<TaskBoardFacts | null>(null)
  const boardId = task?.board_id
  useEffect(() => {
    if (!taskId) setBoard(null)
  }, [taskId])
  useEffect(() => {
    if (!boardId) return
    let live = true
    getTaskBoardFacts(boardId)
      .then((b) => live && setBoard(b))
      .catch(() => live && setBoard(null))
    return () => {
      live = false
    }
  }, [boardId, task])
  // A professor is never locked out of a task by the project closing; a
  // student is, and by their board being handed in.
  const shut =
    role !== 'professor' &&
    (locked || Boolean(board?.project_locked_at || board?.submitted_at))
  useEffect(() => {
    if (!projectId) return
    let live = true
    getProjectStages(projectId)
      .then((s) => live && setStages(s))
      .catch(() => live && setStages(null))
    return () => {
      live = false
    }
  }, [projectId])

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

  async function move(status: TaskStatus, stage: number) {
    if (!task) return
    try {
      await setTaskStatus(task.id, status, stage)
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
      // The standard header, as the work task dialog has it.
      description={task ? stageName(stages, task) : undefined}
      size="xl"
      headerTone="banner"
    >
      {loading && !task ? (
        <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
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
          boardWeight={board && board.total_weight > 0 ? board.total_weight : null}
          locked={shut}
          reassignment={ask}
          viewerCanRequest={role !== 'professor'}
          stages={stagesOf(stages)}
          onStatus={(status, stage) => void move(status, stage)}
          onChanged={async () => {
            await refresh()
            await onChanged()
          }}
        />
      )}
    </Modal>
  )
}
