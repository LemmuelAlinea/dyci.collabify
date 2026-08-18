import { useCallback, useEffect, useState } from 'react'
import {
  getTaskDetail,
  listComments,
  listEvents,
  subscribeToTask,
} from '../lib/api/taskDetail'
import { authErrorMessage } from '../lib/authError'
import type { TaskComment, TaskDetail, TaskEvent } from '../lib/types'

/** One task and everything hanging off it, kept live while the modal is open. */
export function useTaskDetail(taskId: string | null) {
  const [task, setTask] = useState<TaskDetail | null>(null)
  const [comments, setComments] = useState<TaskComment[]>([])
  const [events, setEvents] = useState<TaskEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!taskId) return
    try {
      const [detail, said, done] = await Promise.all([
        getTaskDetail(taskId),
        listComments(taskId),
        listEvents(taskId),
      ])
      setTask(detail)
      setComments(said)
      setEvents(done)
      setError(detail ? null : 'That task is not available to you.')
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load that task.'))
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    if (!taskId) {
      setTask(null)
      setComments([])
      setEvents([])
      return
    }
    setLoading(true)
    void load()
  }, [taskId, load])

  useEffect(() => {
    if (!taskId) return
    return subscribeToTask(taskId, () => void load())
  }, [taskId, load])

  return { task, comments, events, loading, error, reload: load }
}
