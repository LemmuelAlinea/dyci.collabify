import { useCallback, useEffect, useState } from 'react'
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

  return { data, error, reload: load }
}
