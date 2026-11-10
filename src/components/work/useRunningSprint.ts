// src/components/work/useRunningSprint.ts
import { useMemo, useState } from 'react'
import { runningSprints, runningTabs } from '../../lib/work/sprints'
import type { SprintOrganization } from '../../lib/work/sprintSettings'
import type { Sprint } from '../../lib/work/types'

const key = (projectId: string) => `collabify:running-sprint:${projectId}`

function remembered(projectId: string | undefined): string | null {
  if (!projectId) return null
  try {
    return localStorage.getItem(key(projectId))
  } catch {
    return null
  }
}

/**
 * Which running sprint a screen shows when several run. The last pick is kept
 * per project on this device, as a team in streams so it survives that team's
 * next sprint. A pick that no longer has a sprint falls back to the first tab.
 */
export function useRunningSprint({
  projectId,
  sprints,
  organization,
  teams,
  viewerTeamIds,
}: {
  projectId: string | undefined
  sprints: readonly Sprint[]
  organization: SprintOrganization
  teams: readonly { id: string; name: string; archived_at?: string | null }[]
  viewerTeamIds: readonly string[]
}) {
  const stored = useMemo(() => remembered(projectId), [projectId])
  const [chosen, setChosen] = useState<string | null>(null)

  const tabs = runningTabs(sprints, organization, teams, viewerTeamIds)
  const wanted = chosen ?? stored
  const active = tabs.find((t) => t.key === wanted && t.sprint) ?? tabs.find((t) => t.sprint) ?? null
  const sprint: Sprint | null = active ? active.sprint : (runningSprints(sprints)[0] ?? null)

  function pick(next: string) {
    setChosen(next)
    if (!projectId) return
    try {
      localStorage.setItem(key(projectId), next)
    } catch {
      // Private mode or blocked storage: the pick still holds until the page closes.
    }
  }

  return { tabs, activeKey: active?.key ?? null, sprint, pick }
}
