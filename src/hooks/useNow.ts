import { useSyncExternalStore } from 'react'

const MINUTE = 60_000

let now = Date.now()
let timer: ReturnType<typeof setInterval> | undefined
const listeners = new Set<() => void>()

/**
 * One clock for every component that asks, ticking once a minute while any of
 * them is on screen. Starting it again reads the time afresh, so a page opened
 * after an idle spell never shows a stale "now".
 */
export function subscribeNow(listener: () => void) {
  listeners.add(listener)
  if (!timer) {
    now = Date.now()
    timer = setInterval(() => {
      now = Date.now()
      listeners.forEach((l) => l())
    }, MINUTE)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

export function readNow() {
  return now
}

/**
 * The current time in milliseconds, for deciding what is overdue or due soon
 * while rendering. Calling Date.now() in render gives a different answer on
 * every pass; this gives one answer per minute, the same to every component.
 */
export function useNow() {
  return useSyncExternalStore(subscribeNow, readNow)
}
