import { useCallback, useEffect, useRef, useState } from 'react'
import { useLive } from './useLive'
import { listProjectsForClasses } from '../lib/api/projects'
import { authErrorMessage } from '../lib/authError'
import type { ClassSummary, ProjectSummary } from '../lib/types'

/** Projects across a list of classes, loaded in one query for the board. */
export function useProjectsData(classes: Pick<ClassSummary, 'id'>[] | null) {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Only the first load shows as loading. A live refresh (realtime, focus, the
  // poll) swaps the list in place: showing the spinner again unmounted
  // whatever was open under it, a half-written New project dialog included.
  const loaded = useRef(false)

  const load = useCallback(async () => {
    if (!classes) return
    if (!loaded.current) setLoading(true)
    try {
      setProjects(await listProjectsForClasses(classes.map((c) => c.id)))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load projects.'))
    } finally {
      loaded.current = true
      setLoading(false)
    }
  }, [classes])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['projects', 'project_boards', 'project_tasks', 'board_results'])

  return { projects, loading, error, reload: load }
}
