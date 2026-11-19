import { useCallback, useEffect, useState } from 'react'
import { listActiveContacts, type ActiveContact } from '../lib/api/presence'
import { HEARTBEAT_MS } from '../lib/presence'
import { useLive } from './useLive'

/**
 * Your contacts seen in the last hour, refreshed every minute and when you come
 * back to the tab. Null until the first answer; a failed refresh keeps the last list.
 */
export function useActiveContacts(enabled: boolean): ActiveContact[] | null {
  const [contacts, setContacts] = useState<ActiveContact[] | null>(null)
  const load = useCallback(async () => {
    try {
      setContacts(await listActiveContacts())
    } catch {
      setContacts((prev) => prev ?? [])
    }
  }, [])

  useEffect(() => {
    if (enabled) void load()
  }, [enabled, load])

  useLive(load, [], { every: HEARTBEAT_MS, enabled })
  return contacts
}
