// src/components/work/useTeamFilter.ts
import { useMemo, useState } from 'react'
import { initialTeamFilter } from '../../lib/work/teamFilter'

const key = (projectId: string) => `collabify:team-filter:${projectId}`

function remembered(projectId: string | undefined): string | null {
  if (!projectId) return null
  try {
    return localStorage.getItem(key(projectId))
  } catch {
    return null
  }
}

/**
 * The Team filter's choice: '' for All teams, otherwise a team id. Tasks and
 * Backlog share it through this device's storage, so a choice made on one is
 * the other's starting point. Until the person chooses, a team's lead opens on
 * their own team. The choice belongs to one project: switching projects reads
 * that project's remembered choice afresh.
 */
export function useTeamFilter(
  projectId: string | undefined,
  viewerId: string | undefined,
  teams: readonly { id: string; leader_id: string | null }[],
): [string, (teamId: string) => void] {
  const stored = useMemo(() => remembered(projectId), [projectId])
  const [chosen, setChosen] = useState<{ projectId: string | undefined; teamId: string } | null>(null)

  const picked = chosen && chosen.projectId === projectId ? chosen.teamId : null
  // A team can be removed while its id is held, so the choice is read back through the teams.
  const value = initialTeamFilter(picked ?? stored, teams, viewerId)

  function choose(teamId: string) {
    setChosen({ projectId, teamId })
    if (!projectId) return
    try {
      localStorage.setItem(key(projectId), teamId)
    } catch {
      // Private mode or blocked storage: the choice still holds until the page closes.
    }
  }

  return [value, choose]
}
