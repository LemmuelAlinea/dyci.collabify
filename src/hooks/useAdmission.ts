import { useCallback, useEffect, useState } from 'react'
import { amIAdmitted } from '../lib/api/access'
import { useLive } from './useLive'

/**
 * Null while it loads. False only for a student nobody has let in yet.
 *
 * A failed check reads as admitted: the rail is the only thing that narrows on
 * this, and hiding somebody's classes because a request dropped would be worse
 * than briefly showing an empty page they cannot use.
 */
export function useAdmission(userId: string | undefined) {
  const [admitted, setAdmitted] = useState<boolean | null>(null)

  const load = useCallback(async () => {
    if (!userId) return
    try {
      setAdmitted(await amIAdmitted())
    } catch {
      setAdmitted(true)
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['class_members', 'general_space_members', 'general_members'], {
    enabled: Boolean(userId),
  })

  return admitted
}
