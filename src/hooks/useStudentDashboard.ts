import { useCallback, useEffect, useState } from 'react'
import { useLive } from './useLive'
import { studentDashboard } from '../lib/api/dashboard'
import type { StudentDashboard } from '../lib/api/dashboard'
import { authErrorMessage } from '../lib/authError'

/** Everything the student dashboard shows, in one pass. */
export function useStudentDashboard(studentId: string | undefined) {
  const [data, setData] = useState<StudentDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!studentId) return
    try {
      setData(await studentDashboard(studentId))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load your dashboard.'))
    }
  }, [studentId])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['projects', 'project_boards', 'project_tasks', 'task_assignees', 'announcements', 'program_announcements', 'class_members', 'board_results'])

  return { data, error, reload: load }
}
