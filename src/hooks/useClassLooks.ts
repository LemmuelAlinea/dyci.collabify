// src/hooks/useClassLooks.ts
import { useEffect, useState, useSyncExternalStore } from 'react'
import { listClassLooks } from '../lib/api/classes'
import type { ClassLook } from '../lib/classLook'

let version = 0
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Tells every mounted list that a class's look was saved, so it asks again:
 * the rail stays mounted across a save and its ids do not change.
 */
export function notifyClassLooksChanged() {
  version += 1
  listeners.forEach((listener) => listener())
}

/**
 * The color and icon of the listed classes, from one request for the whole
 * list, keyed on its ids, and again when a look is saved. A failed request
 * draws no look: the tile falls back to the class initials.
 */
export function useClassLooks(ids: readonly string[]): Record<string, ClassLook> {
  const key = [...ids].sort().join(',')
  const saved = useSyncExternalStore(subscribe, () => version, () => 0)
  const [looks, setLooks] = useState<Record<string, ClassLook>>({})

  useEffect(() => {
    if (!key) return
    let live = true
    listClassLooks(key.split(','))
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
