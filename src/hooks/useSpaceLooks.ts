// src/hooks/useSpaceLooks.ts
import { useEffect, useState, useSyncExternalStore } from 'react'
import { listSpaceLooks } from '../lib/api/spaces'
import type { ProjectLook } from './useProjectLooks'

let version = 0
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Tells every mounted list that a space's look was saved, so it asks again:
 * the rail stays mounted across a save and its ids do not change.
 */
export function notifySpaceLooksChanged() {
  version += 1
  listeners.forEach((listener) => listener())
}

/**
 * The color and icon of the listed work spaces, from one request for the whole
 * list, keyed on its ids, and again when a look is saved. The space overview
 * carries no look, so it is read straight from general_spaces. A failed
 * request draws no look: the tile falls back to the space's letter.
 */
export function useSpaceLooks(ids: readonly string[]): Record<string, ProjectLook> {
  const key = [...ids].sort().join(',')
  const saved = useSyncExternalStore(subscribe, () => version, () => 0)
  const [looks, setLooks] = useState<Record<string, ProjectLook>>({})

  useEffect(() => {
    if (!key) return
    let live = true
    listSpaceLooks(key.split(','))
      .then((rows) => {
        if (live) setLooks(Object.fromEntries(rows.map((r) => [r.id, { color: r.color, icon: r.icon }])))
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [key, saved])

  return looks
}
