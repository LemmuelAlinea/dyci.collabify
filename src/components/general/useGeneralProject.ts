// src/components/general/useGeneralProject.ts
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLive } from '../../hooks/useLive'
import {
  getCommitRights,
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
import type { CommitRights } from '../../lib/api/general'
import { listMilestones } from '../../lib/api/milestones'
import { listSprints } from '../../lib/api/sprints'
import { authErrorMessage } from '../../lib/authError'
import { can as canDo, canAs } from '../../lib/general/permissions'
import type { GeneralPermission, ProjectRole } from '../../lib/general/permissions'
import { effectiveRole, roleLookup } from '../../lib/general/roleLookup'
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
import type { Milestone, Sprint } from '../../lib/work/types'

const NO_RIGHTS: CommitRights = { commit: false, grant: false, board: false, committers: [] }

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
  /** Oldest start first. */
  sprints: Sprint[]
  /** Soonest due first. */
  milestones: Milestone[]
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
  /**
   * The viewer's role here; null for somebody who reaches the project through
   * its space. A class board's Files project has no roles of its own, so its
   * Owner reads as the project manager and its Manager as a Coordinator.
   */
  myRole: ProjectRole | null
  isOwner: boolean
  ownerCount: number
  can: (permission: GeneralPermission) => boolean
  /** Whether the viewer leads a team that this person is on. */
  leadsUser: (userId: string) => boolean
  /** A member's role as their name should wear it; null for somebody not on the project. */
  roleOf: (userId: string) => ProjectRole | null
  /** Whether the person leads a team of this project. */
  isLead: (userId: string) => boolean
  /** Who may commit to Main and who decides it, from the server. */
  commitRights: CommitRights
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
  const [sprints, setSprints] = useState<Sprint[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [commitRights, setCommitRights] = useState<CommitRights>(NO_RIGHTS)

  const reload = useCallback(async () => {
    if (!projectId) {
      setLoading(false)
      return
    }
    try {
      const found = await getGeneralProject(projectId)
      setProject(found)
      // Nothing to load, and the last project's rows must not stay on screen.
      if (!found) {
        setMembers([])
        setGrants([])
        setRequests([])
        setTeams([])
        setTeamMembers([])
        setPositions([])
        setHolders([])
        setFields([])
        setValues([])
        setTasks([])
        setSprints([])
        setMilestones([])
        setCommitRights(NO_RIGHTS)
        setError(null)
        return
      }
      const [m, g, r, t, tm, p, h, f, tk, sp, ms, cr] = await Promise.all([
        listGeneralMembers(projectId),
        listGrants(projectId),
        listAccessRequests(projectId),
        listTeams(projectId),
        listTeamMembers(projectId),
        listPositions(projectId),
        listPositionHolders(projectId),
        listFields(projectId),
        listTasks(projectId),
        listSprints({ kind: 'work', projectId }),
        listMilestones({ kind: 'work', projectId }),
        getCommitRights(projectId).catch(() => NO_RIGHTS),
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
      setSprints(sp)
      setMilestones(ms)
      setCommitRights(cr)
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
    'general_sprints',
    'general_milestones',
    // A class board's Commit to Main follows its group's leader.
    'groups',
  ])

  return useMemo(() => {
    const me = members.find((m) => m.user_id === viewerId) ?? null
    const myGrants = grants.filter((g) => g.user_id === viewerId).map((g) => g.permission)
    const myOpenRequests = requests
      .filter((r) => r.user_id === viewerId && r.status === 'open')
      .map((r) => r.permission)
    const archived = Boolean(project?.archived_at)
    const legacy = Boolean(me && me.role === 'member' && me.level !== 'member')
    const myRole: ProjectRole | null = me ? effectiveRole(me) : null
    const myTeams = new Set(teams.filter((t) => t.leader_id === viewerId).map((t) => t.id))
    const led = new Set(
      myTeams.size > 0 && myRole !== 'stakeholder'
        ? teamMembers.filter((tm) => myTeams.has(tm.team_id)).map((tm) => tm.user_id)
        : [],
    )
    const names = new Map(
      members.map((m) => [m.user_id, m.profile ? fullName(m.profile) : 'A member']),
    )
    const { roleOf, isLead } = roleLookup(members, teams)
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
      sprints,
      milestones,
      loading,
      missing: !loading && !project && !error,
      error,
      reload,
      viewerId,
      me,
      myGrants,
      myOpenRequests,
      archived,
      myRole,
      isOwner: myRole === 'pm',
      ownerCount: members.filter(
        (m) => effectiveRole(m) === 'pm' && m.profile?.status !== 'rejected',
      ).length,
      can: (permission: GeneralPermission) =>
        permission === 'commit_main'
          ? !archived && commitRights.commit
          : legacy
            ? canDo(me?.level ?? null, myGrants, permission, archived)
            : !archived && canAs(myRole, myGrants, permission),
      leadsUser: (userId: string) => led.has(userId),
      roleOf,
      isLead,
      commitRights,
      nameOf: (userId: string) => names.get(userId) ?? 'A former member',
    }
  }, [project, members, grants, requests, teams, teamMembers, positions, holders, fields, values, tasks, sprints, milestones, loading, error, reload, viewerId, commitRights])
}
