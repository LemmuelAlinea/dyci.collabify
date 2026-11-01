// src/hooks/useProjectLooks.ts
import { useEffect, useState, useSyncExternalStore } from 'react'
import { listProjectLooks } from '../lib/api/general'
import type { ProjectColor, ProjectIcon } from '../lib/general/types'

export type ProjectLook = { color: ProjectColor | null; icon: ProjectIcon | null }

let version = 0
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Tells every mounted list that a project's look was saved, so it asks again.
 * The rail stays mounted across a save and its ids do not change, so without
 * this its tile would keep the old look until a reload.
 */
export function notifyLooksChanged() {
  version += 1
  listeners.forEach((listener) => listener())
}

/**
 * The color and icon of the listed projects, from one request for the whole
 * list. Lists get their projects from overview rows that carry no look, so each
 * list asks once, keyed on its ids, and again when a look is saved
 * (`notifyLooksChanged`). A failed request draws no look: the tile falls back
 * to the project's letter.
 */
export function useProjectLooks(ids: readonly string[]): Record<string, ProjectLook> {
  const key = ids.join(',')
  const saved = useSyncExternalStore(subscribe, () => version, () => 0)
  const [looks, setLooks] = useState<Record<string, ProjectLook>>({})

  useEffect(() => {
    if (!key) return
    let live = true
    listProjectLooks(key.split(','))
      .then((rows) => {
        if (live) setLooks(Object.fromEntries(rows.map((r) => [r.id, { color: r.color, icon: r.icon }])))
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [key, saved])

  // Looks are keyed by project id, so those from the previous list stay harmless
  // and the tiles do not flash back to letters while the next request runs.
  return looks
}
