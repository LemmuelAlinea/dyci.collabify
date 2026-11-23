import { useEffect, useState } from 'react'
import { spaceAwayRanges, type AwayRange } from '../api/workload'

const TTL = 60_000
// One read per space shared by every picker and card on the page, kept a minute.
const cache = new Map<string, { at: number; read: Promise<Map<string, AwayRange[]>> }>()

function readSpace(spaceId: string): Promise<Map<string, AwayRange[]>> {
  const hit = cache.get(spaceId)
  if (hit && Date.now() - hit.at < TTL) return hit.read
  const read = spaceAwayRanges(spaceId)
    .then((rows) => {
      const byUser = new Map<string, AwayRange[]>()
      for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r])
      return byUser
    })
    .catch(() => {
      cache.delete(spaceId)
      return new Map<string, AwayRange[]>()
    })
  cache.set(spaceId, { at: Date.now(), read })
  return read
}

/** Who in a work space is away today or later, by person. Empty while loading or on error. */
export function useAwayRanges(spaceId: string | null | undefined): Map<string, AwayRange[]> {
  const [ranges, setRanges] = useState<Map<string, AwayRange[]>>(() => new Map())
  useEffect(() => {
    if (!spaceId) {
      setRanges(new Map())
      return
    }
    let current = true
    void readSpace(spaceId).then((m) => { if (current) setRanges(m) })
    return () => { current = false }
  }, [spaceId])
  return ranges
}
