import { useEffect, useSyncExternalStore } from 'react'

/**
 * Whether something on the page wants the whole page to itself, like a live
 * discussion room. Pages read it to put their banner away; whatever claims it
 * gives it back when it closes or unmounts.
 */
let claims = 0
const listeners = new Set<() => void>()

function set(delta: number) {
  claims = Math.max(0, claims + delta)
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** True while anything on the page holds focus mode. */
export function useFocusMode() {
  return useSyncExternalStore(subscribe, () => claims > 0, () => false)
}

/** Holds focus mode for as long as `active` is true and the caller is mounted. */
export function useFocusWhile(active: boolean) {
  useEffect(() => {
    if (!active) return
    set(1)
    return () => set(-1)
  }, [active])
}
