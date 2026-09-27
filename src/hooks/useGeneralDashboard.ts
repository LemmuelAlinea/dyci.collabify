import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLive } from './useLive'
import { listMyInvitations, listMyOpenReviews, listSpaceOpenTasks } from '../lib/api/general'
import { authErrorMessage } from '../lib/authError'
import type { GeneralRepoChange, GeneralTask, MyInvitation } from '../lib/general/types'

export type GeneralDashboard = {
  tasks: GeneralTask[]
  reviews: GeneralRepoChange[]
  invitations: MyInvitation[]
  /** When this was read. Dates on the page are judged against it, so a render never calls the clock. */
  at: number
}

/**
 * What a space's dashboard needs beyond the project list the navigation
 * already holds: open tasks, reviews on me, and invitations to answer.
 *
 * Keyed on the project ids, so switching space or a project arriving reloads it.
 */
export function useGeneralDashboard(userId: string | undefined, projectIds: string[]) {
  const [data, setData] = useState<GeneralDashboard | null>(null)
  // The key `data` was loaded for. While a load for a new key is in flight,
  // this still names the old one, so a page switching project ids doesn't
  // flash the previous ids' numbers as if they belonged to the new ones.
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = projectIds.join(',')
  const ids = useMemo(() => (key ? key.split(',') : []), [key])

  // The key the newest load was started for. A slower answer for an older key
  // must not land on top of it and leave the page waiting for data it will
  // never report as current.
  const latest = useRef(key)
  // Declared before the load effect, so the ref names the new key before that
  // load starts. A new key also drops the old key's error.
  useEffect(() => {
    latest.current = key
    setError(null)
  }, [key])

  const load = useCallback(async () => {
    if (!userId) return
    try {
      const [tasks, reviews, invitations] = await Promise.all([
        listSpaceOpenTasks(ids),
        listMyOpenReviews(ids, userId),
        listMyInvitations(userId),
      ])
      if (latest.current !== key) return
      setData({ tasks, reviews, invitations, at: Date.now() })
      setLoadedKey(key)
      setError(null)
    } catch (err) {
      if (latest.current !== key) return
      setError(authErrorMessage(err, 'Could not load this space’s dashboard.'))
    }
  }, [userId, ids, key])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['general_tasks', 'general_task_assignees', 'general_repo_changes', 'general_invitations'])

  return { data: loadedKey === key ? data : null, error, reload: load }
}
