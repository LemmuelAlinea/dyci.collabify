import { useCallback, useEffect, useState } from 'react'
import { listMyInvitations } from '../lib/api/general'
import { authErrorMessage } from '../lib/authError'
import type { MyInvitation } from '../lib/general/types'
import { useLive } from './useLive'

/**
 * Project invitations waiting for this person's answer. Space and class
 * invitations come from the navigation context, which already loads them.
 * Null while the first load is in flight.
 */
export function usePendingInvitations(userId: string | undefined) {
  const [invitations, setInvitations] = useState<MyInvitation[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!userId) {
      setInvitations([])
      setError(null)
      return
    }
    try {
      setInvitations(await listMyInvitations(userId))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load your invitations.'))
    }
  }, [userId])

  useEffect(() => {
    void reload()
  }, [reload])

  useLive(reload, ['general_invitations'], { enabled: Boolean(userId) })

  return { invitations, error, reload }
}
