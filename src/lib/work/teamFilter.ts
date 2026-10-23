/**
 * The Team filter on Tasks and Backlog. A task belongs to a team when it is
 * filed under the team or when anyone on the team holds it, so a task a
 * teammate picked up shows under the team even if it was never filed there.
 */

/** A chosen team and who is on it. */
export type TeamSelection = { id: string; memberIds: readonly string[] }

/** The chosen team with its people; null for All teams, which narrows nothing. */
export function teamSelection(
  links: readonly { team_id: string; user_id: string }[],
  teamId: string,
): TeamSelection | null {
  if (!teamId) return null
  return { id: teamId, memberIds: links.filter((l) => l.team_id === teamId).map((l) => l.user_id) }
}

/**
 * Tasks filed under the team or held by one of its people; everything when
 * `selection` is null. `read` says where a task keeps its team and holders,
 * since a project task and a backlog row name them differently.
 */
export function filterByTeam<T>(
  items: T[],
  selection: TeamSelection | null,
  read: (item: T) => { teamId?: string | null; holders?: readonly string[] },
): T[] {
  if (!selection) return items
  const team = new Set(selection.memberIds)
  return items.filter((item) => {
    const { teamId, holders } = read(item)
    return teamId === selection.id || (holders ?? []).some((id) => team.has(id))
  })
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
