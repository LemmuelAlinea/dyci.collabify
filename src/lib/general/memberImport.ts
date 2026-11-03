import type { RosterRow } from './memberImportFile'
import type { GeneralMember, GeneralTeam, GeneralTeamMember, GeneralPosition, GeneralPositionHolder, GeneralMemberSkill } from './types'
import { normalizeTag, SKILL_LIMIT } from './skills'

export type ResolvedImportRow = Omit<RosterRow, 'source'> & { userId: string; sources: string[] }

const clean = (value: string) => value.trim().replace(/\s+/g, ' ')
const key = (value: string) => clean(value).toLowerCase()
const positionKey = (value: RosterRow['positions'][number]) => JSON.stringify([value.scope, key(value.team), key(value.name)])

function unique<T>(values: T[], identify: (value: T) => string): T[] {
  const seen = new Set<string>()
  return values.filter(value => {
    const id = identify(value)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export function resolveMemberImport(rows: RosterRow[], members: { userId: string; name: string }[], choices: Record<number, string>) {
  const resolved: ResolvedImportRow[] = []
  const unknown: RosterRow[] = []
  const ambiguous: { row: number; candidates: string[] }[] = []
  const conflicts: string[] = []
  rows.forEach((row, index) => {
    const candidates = unique(members.filter(member => key(member.name) === key(row.name)), member => member.userId)
    if (!candidates.length) { unknown.push(row); return }
    const choice = choices[index]
    if (choice !== undefined && !candidates.some(member => member.userId === choice)) {
      conflicts.push(`${row.source}: Choose a current member matching ${clean(row.name)}.`)
      return
    }
    if (candidates.length > 1 && choice === undefined) {
      ambiguous.push({ row: index, candidates: candidates.map(member => member.userId) })
      return
    }
    const userId = choice ?? candidates[0].userId
    let target = resolved.find(member => member.userId === userId)
    if (!target) {
      target = { userId, name: clean(row.name), sources: [], teams: [], positions: [], skills: [], present: { teams: false, positions: false, skills: false } }
      resolved.push(target)
    }
    target.sources.push(row.source)
    for (const field of ['teams', 'positions', 'skills'] as const) {
      if (!row.present[field]) continue
      if (target.present[field] && (target[field].length === 0) !== (row[field].length === 0)) {
        conflicts.push(`${row.source}: ${target.name} lists both none and values for ${field}. Correct the file.`)
      }
      target.present[field] = true
      if (field === 'positions') {
        target.positions = unique([...target.positions, ...row.positions.map(p => ({ ...p, team: clean(p.team), name: clean(p.name) }))], positionKey)
      } else {
        target[field] = unique([...target[field], ...row[field].map(clean)], key)
      }
    }
  })
  return { resolved, unknown, ambiguous, conflicts }
}

/** Full raw project structure, including archived teams and their memberships/holders. */
export type ImportCurrent = {
  members: Pick<GeneralMember, 'user_id' | 'role'>[]
  teams: Pick<GeneralTeam, 'id' | 'name' | 'leader_id' | 'archived_at'>[]
  teamMembers: Pick<GeneralTeamMember, 'team_id' | 'user_id'>[]
  positions: Pick<GeneralPosition, 'id' | 'team_id' | 'name'>[]
  holders: Pick<GeneralPositionHolder, 'position_id' | 'user_id'>[]
  skills: Pick<GeneralMemberSkill, 'user_id' | 'tag'>[]
}
type ImportPosition = { team: string; name: string }
type ImportValues = { teams: string[]; positions: ImportPosition[]; skills: string[] }
export type ImportApplyRow = {
  user_id: string
  teams: string[] | null
  /** Empty team means explicitly project-wide; unknown scope never reaches this payload. */
  positions: ImportPosition[] | null
  skills: string[] | null
}
export type ImportPreview = {
  members: { userId: string; name: string; current: ImportValues; proposed: ImportValues; additions: ImportValues; removals: ImportValues }[]
  newTeams: string[]
  newPositions: ImportPosition[]
  rows: ImportApplyRow[]
  /**
   * SQL JSONB equality contract: all keys below are required, no extra fields.
   * members contains only included user_ids, sorted by UUID text. Each member
   * records the exact role, all team_ids and position_ids (sorted by UUID text),
   * and skills as { [exact stored tag]: true }; object key order is irrelevant.
   * teams/positions contain the COMPLETE project catalog, including archived
   * teams, sorted by id text. Catalog names are exact stored strings, not cleaned.
   * This detects new catalog collisions as well as renames/deletes/leader changes.
   * SQL reproduces arrays with ORDER BY id::text COLLATE "C", empty arrays as [],
   * empty skills as {}, and nullable team_id/leader_id as JSON null.
   * archived is the boolean expression archived_at IS NOT NULL, avoiding timestamp
   * serialization differences between PostgREST and PostgreSQL JSONB.
   */
  expected: {
    members: { user_id: string; role: GeneralMember['role']; team_ids: string[]; position_ids: string[]; skills: Record<string, true> }[]
    teams: { id: string; name: string; leader_id: string | null; archived: boolean }[]
    positions: ImportCurrent['positions']
  }
  blockers: string[]
}

const scopedKey = (position: ImportPosition) => JSON.stringify([key(position.team), key(position.name)])
const sortId = <T extends { id: string }>(values: T[]) => [...values].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export function previewMemberImport(mode: 'add' | 'replace', resolved: ResolvedImportRow[], current: ImportCurrent, excluded: Set<string>): ImportPreview {
  const included = resolved.filter(row => !excluded.has(row.userId))
  const result: ImportPreview = {
    members: [], newTeams: [], newPositions: [], rows: [], blockers: [],
    expected: {
      members: [],
      teams: sortId(current.teams).map(({ id, name, leader_id, archived_at }) => ({ id, name, leader_id, archived: archived_at !== null })),
      positions: sortId(current.positions).map(({ id, team_id, name }) => ({ id, team_id, name })),
    },
  }
  if (included.length > 100) result.blockers.push('Import up to 100 members at a time.')
  if (new Set(included.map(row => row.userId)).size !== included.length) result.blockers.push('Combine repeated member rows before reviewing the import.')
  const teamName = (name: string): string => {
    const normalized = clean(name)
    if (!normalized || [...normalized].length > 80) result.blockers.push('Keep team names between 1 and 80 characters.')
    const matches = current.teams.filter(team => key(team.name) === key(normalized))
    if (matches.length > 1) result.blockers.push(`More than one team matches ${normalized}. Rename the duplicate before importing.`)
    if (matches[0]) {
      if (matches[0].archived_at) result.blockers.push(`${clean(matches[0].name)} is archived. Restore the team before importing.`)
      return clean(matches[0].name)
    }
    const existing = result.newTeams.find(team => key(team) === key(normalized))
    if (existing !== undefined) return existing
    result.newTeams.push(normalized)
    return normalized
  }
  const positionName = (position: RosterRow['positions'][number]): ImportPosition => {
    if (position.scope === 'unknown' || (position.scope === 'team' && !clean(position.team)) || (position.scope === 'project' && clean(position.team))) {
      result.blockers.push(`${clean(position.name)} needs a clear team or explicit project-wide scope. Correct the file.`)
    }
    const team = position.scope === 'team' ? teamName(position.team) : ''
    const name = clean(position.name)
    if (!name || [...name].length > 80) result.blockers.push('Keep position names between 1 and 80 characters.')
    const teamId = team ? current.teams.find(t => key(t.name) === key(team))?.id : null
    const matches = current.positions.filter(p => p.team_id === teamId && key(p.name) === key(name))
    if (matches.length > 1) result.blockers.push(`More than one position matches ${team ? `${team} / ` : ''}${name}. Rename the duplicate before importing.`)
    if (matches[0]) return { team, name: clean(matches[0].name) }
    const existing = result.newPositions.find(p => scopedKey(p) === scopedKey({ team, name }))
    if (existing) return existing
    const created = { team, name }
    result.newPositions.push(created)
    return created
  }
  for (const row of included) {
    const member = current.members.find(member => member.user_id === row.userId)
    if (!member) { result.blockers.push(`${row.name} is no longer a project member. Refresh and upload again.`); continue }
    const teamIds = unique(current.teamMembers.filter(m => m.user_id === row.userId).map(m => m.team_id), id => id).sort()
    const positionIds = unique(current.holders.filter(h => h.user_id === row.userId).map(h => h.position_id), id => id).sort()
    const skills = current.skills.filter(s => s.user_id === row.userId).map(s => s.tag)
    result.expected.members.push({ user_id: row.userId, role: member.role, team_ids: teamIds, position_ids: positionIds, skills: Object.fromEntries(skills.map(tag => [tag, true as const])) })
    const before: ImportValues = {
      teams: teamIds.map(id => clean(current.teams.find(t => t.id === id)?.name ?? '')),
      positions: positionIds.map(id => {
        const position = current.positions.find(p => p.id === id)
        if (!position) { result.blockers.push('A held position is missing. Refresh project data before importing.'); return { team: '', name: '' } }
        return { team: position.team_id ? clean(current.teams.find(t => t.id === position.team_id)?.name ?? '') : '', name: clean(position.name) }
      }),
      skills,
    }
    if (before.teams.some(name => !name)) result.blockers.push('A member team is missing. Refresh project data before importing.')
    const incomingTeams = row.present.teams ? unique(row.teams.map(teamName), key) : []
    const incomingPositions = row.present.positions ? unique(row.positions.map(positionName), scopedKey) : []
    const incomingSkills = row.present.skills ? unique(row.skills.map(tag => {
      const normalized = normalizeTag(tag)
      if (!normalized) result.blockers.push(`${row.name}: Keep skills between 1 and 40 characters.`)
      return skills.find(existing => key(existing) === key(tag)) ?? normalized ?? clean(tag)
    }), key) : []
    const after: ImportValues = {
      teams: unique([...(mode === 'replace' && row.present.teams ? [] : before.teams), ...incomingTeams, ...incomingPositions.map(p => p.team).filter(Boolean)], key),
      positions: unique([...(mode === 'replace' && row.present.positions ? [] : before.positions), ...incomingPositions], scopedKey),
      skills: unique([...(mode === 'replace' && row.present.skills ? [] : before.skills), ...incomingSkills], key),
    }
    if (row.present.skills && incomingSkills.length && (member.role === 'qa' || member.role === 'stakeholder')) result.blockers.push(`${row.name}: QA and stakeholders cannot carry skill tags.`)
    if (after.skills.length > SKILL_LIMIT) result.blockers.push(`${row.name}: Up to 12 skills each.`)
    for (const id of teamIds) {
      const team = current.teams.find(t => t.id === id)
      if (team && !after.teams.some(name => key(name) === key(team.name)) && team.leader_id === row.userId) result.blockers.push(`${row.name} is the leader of ${clean(team.name)}. Change the leader before removing their membership.`)
    }
    for (const position of after.positions) {
      if (position.team && !after.teams.some(team => key(team) === key(position.team))) result.blockers.push(`${row.name}: The ${position.name} position still needs membership in ${position.team}. Correct the file.`)
    }
    // Existing name collisions cannot be represented safely by this name-based payload.
    if (row.present.teams || row.present.positions) {
      for (const name of after.teams) {
        if (current.teams.filter(t => key(t.name) === key(name)).length > 1) result.blockers.push(`${row.name}: The ${name} team is ambiguous. Rename the duplicate before importing.`)
      }
    }
    for (const position of after.positions) {
      const teamId = position.team ? current.teams.find(t => key(t.name) === key(position.team))?.id : null
      if (current.positions.filter(p => p.team_id === teamId && key(p.name) === key(position.name)).length > 1) result.blockers.push(`${row.name}: The ${position.name} position is ambiguous. Rename the duplicate before importing.`)
    }
    const difference = (left: ImportValues, right: ImportValues): ImportValues => ({
      teams: left.teams.filter(t => !right.teams.some(r => key(t) === key(r))),
      positions: left.positions.filter(p => !right.positions.some(r => scopedKey(p) === scopedKey(r))),
      skills: left.skills.filter(s => !right.skills.some(r => key(s) === key(r))),
    })
    result.members.push({ userId: row.userId, name: row.name, current: before, proposed: after, additions: difference(after, before), removals: difference(before, after) })
    result.rows.push({ user_id: row.userId, teams: row.present.teams || incomingPositions.some(p => p.team) ? after.teams : null, positions: row.present.positions ? after.positions : null, skills: row.present.skills ? after.skills : null })
  }
  result.expected.members.sort((a, b) => a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0)
  result.blockers = unique(result.blockers, value => value)
  if (result.blockers.length) result.rows = []
  return result
}
