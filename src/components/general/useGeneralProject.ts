// src/components/general/useGeneralProject.ts
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLive } from '../../hooks/useLive'
import {
  getGeneralProject,
  listAccessRequests,
  listFieldValues,
  listFields,
  listGeneralMembers,
  listGrants,
  listPositionHolders,
  listPositions,
  listTasks,
  listTeamMembers,
  listTeams,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { can as canDo } from '../../lib/general/permissions'
import type { GeneralPermission } from '../../lib/general/permissions'
import type {
  GeneralAccessRequest,
  GeneralField,
  GeneralFieldValue,
  GeneralGrant,
  GeneralMember,
  GeneralPosition,
  GeneralPositionHolder,
  GeneralProjectSummary,
  GeneralTask,
  GeneralTeam,
  GeneralTeamMember,
} from '../../lib/general/types'
import { fullName } from '../../lib/types'

export type GeneralProjectState = {
  project: GeneralProjectSummary | null
  members: GeneralMember[]
  grants: GeneralGrant[]
  requests: GeneralAccessRequest[]
  teams: GeneralTeam[]
  teamMembers: GeneralTeamMember[]
  positions: GeneralPosition[]
  holders: GeneralPositionHolder[]
  fields: GeneralField[]
  values: GeneralFieldValue[]
  tasks: GeneralTask[]
  loading: boolean
  /** Loaded, and there is no project this viewer can see. */
  missing: boolean
  error: string | null
  reload: () => Promise<void>
  viewerId: string | undefined
  me: GeneralMember | null
  myGrants: GeneralPermission[]
  myOpenRequests: GeneralPermission[]
  archived: boolean
  isOwner: boolean
  ownerCount: number
  can: (permission: GeneralPermission) => boolean
  nameOf: (userId: string) => string
}

/**
 * One project and everything about the viewer in it, loaded together.
 *
 * Every tab reads the same copy, so the Members tab granting a permission and
 * the Tasks tab offering a button can never disagree about what the viewer may
 * do. Realtime reloads it whenever anything under the project changes.
 */
export function useGeneralProject(
  projectId: string | undefined,
  viewerId: string | undefined,
): GeneralProjectState {
  const [project, setProject] = useState<GeneralProjectSummary | null>(null)
  const [members, setMembers] = useState<GeneralMember[]>([])
  const [grants, setGrants] = useState<GeneralGrant[]>([])
  const [requests, setRequests] = useState<GeneralAccessRequest[]>([])
  const [teams, setTeams] = useState<GeneralTeam[]>([])
  const [teamMembers, setTeamMembers] = useState<GeneralTeamMember[]>([])
  const [positions, setPositions] = useState<GeneralPosition[]>([])
  const [holders, setHolders] = useState<GeneralPositionHolder[]>([])
  const [fields, setFields] = useState<GeneralField[]>([])
  const [values, setValues] = useState<GeneralFieldValue[]>([])
  const [tasks, setTasks] = useState<GeneralTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!projectId) return
    try {
      const found = await getGeneralProject(projectId)
      setProject(found)
      if (!found) return
      const [m, g, r, t, tm, p, h, f, tk] = await Promise.all([
        listGeneralMembers(projectId),
        listGrants(projectId),
        listAccessRequests(projectId),
        listTeams(projectId),
        listTeamMembers(projectId),
        listPositions(projectId),
        listPositionHolders(projectId),
        listFields(projectId),
        listTasks(projectId),
      ])
      setMembers(m)
      setGrants(g)
      setRequests(r)
      setTeams(t)
      setTeamMembers(tm)
      setPositions(p)
      setHolders(h)
      setFields(f)
      setTasks(tk)
      setValues(await listFieldValues(f.map((x) => x.id)))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load this project.'))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    void reload()
  }, [reload])

  useLive(reload, [
    'general_projects',
    'general_join_codes',
    'general_members',
    'general_grants',
    'general_access_requests',
    'general_invitations',
    'general_teams',
    'general_team_members',
    'general_positions',
    'general_position_holders',
    'general_fields',
    'general_field_values',
    'general_tasks',
    'general_task_assignees',
  ])

  return useMemo(() => {
    const me = members.find((m) => m.user_id === viewerId) ?? null
    const myGrants = grants.filter((g) => g.user_id === viewerId).map((g) => g.permission)
    const myOpenRequests = requests
      .filter((r) => r.user_id === viewerId && r.status === 'open')
      .map((r) => r.permission)
    const archived = Boolean(project?.archived_at)
    const names = new Map(
      members.map((m) => [m.user_id, m.profile ? fullName(m.profile) : 'A member']),
    )
    return {
      project,
      members,
      grants,
      requests,
      teams,
      teamMembers,
      positions,
      holders,
      fields,
      values,
      tasks,
      loading,
      missing: !loading && !project && !error,
      error,
      reload,
      viewerId,
      me,
      myGrants,
      myOpenRequests,
      archived,
      isOwner: me?.level === 'owner',
      ownerCount: members.filter((m) => m.level === 'owner').length,
      can: (permission: GeneralPermission) =>
        canDo(me?.level ?? null, myGrants, permission, archived),
      nameOf: (userId: string) => names.get(userId) ?? 'A former member',
    }
  }, [project, members, grants, requests, teams, teamMembers, positions, holders, fields, values, tasks, loading, error, reload, viewerId])
}
