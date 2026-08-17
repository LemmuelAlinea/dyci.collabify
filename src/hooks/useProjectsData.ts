import { useCallback, useEffect, useState } from 'react'
import { listProjectsForClasses } from '../lib/api/projects'
import { authErrorMessage } from '../lib/authError'
import type { ClassSummary, ProjectSummary } from '../lib/types'

/** Projects across a list of classes, loaded in one query for the board. */
export function useProjectsData(classes: ClassSummary[] | null) {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!classes) return
    setLoading(true)
    try {
      setProjects(await listProjectsForClasses(classes.map((c) => c.id)))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load projects.'))
    } finally {
      setLoading(false)
    }
  }, [classes])

  useEffect(() => {
    void load()
  }, [load])

  return { projects, loading, error, reload: load }
}
