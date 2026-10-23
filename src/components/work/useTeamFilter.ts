// src/components/work/useTeamFilter.ts
import { useState } from 'react'
import { initialTeamFilter } from '../../lib/work/teamFilter'

const key = (projectId: string) => `collabify:team-filter:${projectId}`

function remembered(projectId: string): string | null {
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
 * their own team.
 */
export function useTeamFilter(
  projectId: string | undefined,
  viewerId: string | undefined,
  teams: readonly { id: string; leader_id: string | null }[],
): [string, (teamId: string) => void] {
  const [stored] = useState(() => (projectId ? remembered(projectId) : null))
  const [chosen, setChosen] = useState<string | null>(null)

  // A team can be removed while its id is held, so the choice is read back through the teams.
  const value = initialTeamFilter(chosen ?? stored, teams, viewerId)

  function choose(teamId: string) {
    setChosen(teamId)
    if (!projectId) return
    try {
      localStorage.setItem(key(projectId), teamId)
    } catch {
      // Private mode or blocked storage: the choice still holds until the page closes.
    }
  }

  return [value, choose]
}
