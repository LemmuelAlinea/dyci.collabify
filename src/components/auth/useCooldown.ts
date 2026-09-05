import { useEffect, useState } from 'react'
import { retryAfter, waitLabel } from '../../lib/rateLimit'
import type { Action } from '../../lib/rateLimit'

/**
 * The live half of the rate limiter: a wait that visibly counts down.
 *
 * The module itself is pure and answers "how long", which is what the auth
 * calls need. A form needs the answer to keep changing while somebody looks
 * at it — a button that stays disabled with a number that never moves reads as
 * broken rather than as a wait.
 *
 * Ticks once a second and only while a wait is running, so an idle form costs
 * nothing.
 */
export function useCooldown(action: Action, identifier: string) {
  const [remaining, setRemaining] = useState(() => retryAfter(action, identifier))
  // Extracted so the dependency is statically checkable. What the effect cares
  // about is whether a wait is running at all, not how much of it is left —
  // depending on `remaining` itself would tear down and rebuild the interval
  // on every tick.
  const running = remaining > 0

  useEffect(() => {
    setRemaining(retryAfter(action, identifier))
    if (retryAfter(action, identifier) <= 0) return
    const id = window.setInterval(() => {
      const left = retryAfter(action, identifier)
      setRemaining(left)
      if (left <= 0) window.clearInterval(id)
    }, 1000)
    return () => window.clearInterval(id)
  }, [action, identifier, running])

  return {
    blocked: remaining > 0,
    remaining,
    label: waitLabel(remaining),
    /** Call after a failed attempt so the countdown picks up the new wait. */
    refresh: () => setRemaining(retryAfter(action, identifier)),
  }
}
