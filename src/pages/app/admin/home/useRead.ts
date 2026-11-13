import { useCallback, useEffect, useState } from 'react'

/**
 * One read for one band. Each band on the admin's Home loads, fails and retries
 * on its own, so one read going down never blanks the others. `read` must be
 * stable (a module-level API function), or it reloads on every render.
 */
export function useRead<T>(read: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    setData(null)
    read().then(
      (d) => setData(() => d),
      () => setFailed(true),
    )
  }, [read])

  useEffect(load, [load])

  return { data, failed, load }
}
