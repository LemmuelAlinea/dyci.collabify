// src/hooks/useProjectLooks.ts
import { useEffect, useState } from 'react'
import { listProjectLooks } from '../lib/api/general'
import type { ProjectColor, ProjectIcon } from '../lib/general/types'

export type ProjectLook = { color: ProjectColor | null; icon: ProjectIcon | null }

/**
 * The color and icon of the listed projects, from one request for the whole
 * list. Lists get their projects from overview rows that carry no look, so each
 * list asks once, keyed on its ids. A failed request draws no look: the tile
 * falls back to the project's letter.
 */
export function useProjectLooks(ids: readonly string[]): Record<string, ProjectLook> {
  const key = ids.join(',')
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
  }, [key])

  // Looks are keyed by project id, so those from the previous list stay harmless
  // and the tiles do not flash back to letters while the next request runs.
  return looks
}
