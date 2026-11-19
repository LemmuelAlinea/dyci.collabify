import { useEffect } from 'react'
import { touchPresence } from '../lib/api/presence'
import { HEARTBEAT_MS } from '../lib/presence'

let warned = false

/**
 * Tells the server this person is here, about once a minute, while the tab is
 * visible. A background tab stops, so someone who walked away goes quiet within
 * a couple of minutes. A missed beat only delays a dot, so errors are not shown.
 */
export function usePresenceHeartbeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const beat = () => {
      if (document.visibilityState !== 'visible') return
      touchPresence().catch((err: unknown) => {
        if (warned) return
        warned = true
        console.warn('[collabify] could not record active status', err)
      })
    }
    beat()
    const id = setInterval(beat, HEARTBEAT_MS)
    window.addEventListener('focus', beat)
    document.addEventListener('visibilitychange', beat)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', beat)
      document.removeEventListener('visibilitychange', beat)
    }
  }, [enabled])
}
