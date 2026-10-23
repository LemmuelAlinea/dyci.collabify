// src/components/messages/useProjectRoles.ts
import { useEffect, useState } from 'react'
import { listTeams } from '../../lib/api/general'
import { listProjectMembers } from '../../lib/api/spaces'
import { roleLookup } from '../../lib/general/roleLookup'
import type { ConversationCard } from '../../lib/types'

type Roles = ReturnType<typeof roleLookup>

/**
 * Who is what in a project's chat, loaded once when its conversation opens.
 * Other conversations get null, and a failed load leaves the names bare: a
 * badge is never worth an error in the middle of a chat.
 */
export function useProjectRoles(conversation: ConversationCard): Roles | null {
  const projectId = conversation.kind === 'project' ? conversation.general_project_id : null
  const [loaded, setLoaded] = useState<{ projectId: string; roles: Roles } | null>(null)

  useEffect(() => {
    if (!projectId) return
    let alive = true
    void Promise.all([listProjectMembers(projectId), listTeams(projectId)])
      .then(([people, teams]) => {
        if (alive) setLoaded({ projectId, roles: roleLookup(people, teams) })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [projectId])

  return projectId && loaded?.projectId === projectId ? loaded.roles : null
}
