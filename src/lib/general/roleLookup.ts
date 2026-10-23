import type { GeneralLevel, ProjectRole } from './permissions'

const LEVEL_ROLE: Record<GeneralLevel, ProjectRole> = {
  owner: 'pm',
  manager: 'coordinator',
  member: 'member',
}

/**
 * A class board's Files project keeps the old model: every row is a member by
 * role while its level is Owner or Manager. On a work project level follows
 * role, so a row like that cannot exist there. A row with no role (a database
 * that predates roles) reads from its level.
 */
export function effectiveRole(m: { role?: ProjectRole; level: GeneralLevel }): ProjectRole {
  const role = m.role ?? 'member'
  return role === 'member' && m.level !== 'member' ? LEVEL_ROLE[m.level] : role
}

/** Who is what on a project, for badges beside names. */
export function roleLookup(
  people: readonly { user_id: string; role?: ProjectRole; level: GeneralLevel }[],
  teams: readonly { leader_id: string | null }[],
) {
  const roles = new Map(people.map((p) => [p.user_id, effectiveRole(p)] as const))
  const leaders = new Set(teams.flatMap((t) => (t.leader_id ? [t.leader_id] : [])))
  return {
    /** Null for somebody who is not a member. */
    roleOf: (userId: string): ProjectRole | null => roles.get(userId) ?? null,
    isLead: (userId: string): boolean => leaders.has(userId),
  }
}
