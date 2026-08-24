import { useCallback, useEffect, useState } from 'react'
import { useLive } from './useLive'
import {
  getTaskDetail,
  listComments,
  listEvents,
  listFiles,
  listWorkLog,
  subscribeToTask,
} from '../lib/api/taskDetail'
import { authErrorMessage } from '../lib/authError'
import type {
  TaskComment,
  TaskDetail,
  TaskEvent,
  TaskFile,
  WorkLogEntry,
} from '../lib/types'

/** One task and everything hanging off it, kept live while the modal is open. */
export function useTaskDetail(taskId: string | null) {
  const [task, setTask] = useState<TaskDetail | null>(null)
  const [comments, setComments] = useState<TaskComment[]>([])
  const [events, setEvents] = useState<TaskEvent[]>([])
  const [files, setFiles] = useState<TaskFile[]>([])
  const [worklog, setWorklog] = useState<WorkLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!taskId) return
    try {
      const [detail, said, done, attached, logged] = await Promise.all([
        getTaskDetail(taskId),
        listComments(taskId),
        listEvents(taskId),
        listFiles(taskId),
        listWorkLog(taskId),
      ])
      setTask(detail)
      setComments(said)
      setEvents(done)
      setFiles(attached)
      setWorklog(logged)
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
      setFiles([])
      setWorklog([])
      return
    }
    setLoading(true)
    void load()
  }, [taskId, load])

  useEffect(() => {
    if (!taskId) return
    return subscribeToTask(taskId, () => void load())
  }, [taskId, load])

  // Channel above; this is only the come-back-to-the-tab refresh.
  useLive(load, [], { every: 0, enabled: Boolean(taskId) })

  return { task, comments, events, files, worklog, loading, error, reload: load }
}
