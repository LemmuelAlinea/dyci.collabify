/**
 * The Team filter on Tasks and Backlog. A team's tasks are the tasks held by
 * anyone on the team, so a task a teammate holds shows under the team even if
 * it was never filed under it.
 */

/** The ids on one team; null for All teams, which narrows nothing. */
export function teamMemberIds(
  links: readonly { team_id: string; user_id: string }[],
  teamId: string,
): string[] | null {
  if (!teamId) return null
  return links.filter((l) => l.team_id === teamId).map((l) => l.user_id)
}

/**
 * Tasks held by at least one of the people; everything when `memberIds` is
 * null. `holders` says who holds a task, since a project task and a backlog
 * row keep their holders under different names.
 */
export function filterByTeam<T>(
  items: T[],
  memberIds: readonly string[] | null,
  holders: (item: T) => readonly string[] | undefined,
): T[] {
  if (!memberIds) return items
  const team = new Set(memberIds)
  return items.filter((i) => (holders(i) ?? []).some((id) => team.has(id)))
}

/**
 * What the filter opens on. A remembered choice wins while its team exists
 * ('' is the choice All teams). With none, a team's lead opens on their own
 * team and everybody else on All teams.
 */
export function initialTeamFilter(
  stored: string | null,
  teams: readonly { id: string; leader_id: string | null }[],
  viewerId: string | undefined,
): string {
  if (stored === '') return ''
  if (stored && teams.some((t) => t.id === stored)) return stored
  const led = viewerId ? teams.find((t) => t.leader_id === viewerId) : undefined
  return led?.id ?? ''
}
