import { useCallback, useEffect, useState } from 'react'
import { useLive } from './useLive'
import { listProfessorClasses } from '../lib/api/classes'
import { professorDashboard } from '../lib/api/dashboard'
import type { ProfessorDashboard } from '../lib/api/dashboard'
import { authErrorMessage } from '../lib/authError'

/** Everything the professor dashboard shows, in one pass. */
export function useProfessorDashboard(professorId: string | undefined) {
  const [data, setData] = useState<ProfessorDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!professorId) return
    try {
      const classes = await listProfessorClasses(professorId)
      setData(await professorDashboard(professorId, classes))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load your dashboard.'))
    }
  }, [professorId])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['classes', 'projects', 'project_boards', 'project_tasks', 'announcements', 'program_announcements', 'class_members', 'board_results', 'task_reassignments'])

  return { data, error, reload: load }
}
