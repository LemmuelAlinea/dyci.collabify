import { describe, expect, it } from 'vitest'
import type { RosterRow } from './memberImportFile'
import { previewMemberImport, resolveMemberImport } from './memberImport'
import type { ImportCurrent } from './memberImport'

function row(patch: Partial<RosterRow> = {}): RosterRow {
  return { name: 'Alex Cruz', source: 'Sheet 1 row 2', teams: [], positions: [], skills: [], present: { teams: false, positions: false, skills: false }, ...patch }
}
const members = [{ userId: 'a', name: 'Alex Cruz' }, { userId: 'b', name: 'Sam Lee' }]

describe('resolveMemberImport', () => {
  it('matches only full current member names, ignoring case and extra whitespace', () => {
    const result = resolveMemberImport([row({ name: '  ALEX   cruz ' })], members, {})
    expect(result.resolved.map(r => r.userId)).toEqual(['a'])
    expect(result.unknown).toEqual([])
    expect(result.conflicts).toEqual([])
  })
  it('requires a valid candidate choice for duplicate names', () => {
    const roster = [...members, { userId: 'c', name: 'Alex Cruz' }]
    expect(resolveMemberImport([row()], roster, {}).ambiguous).toEqual([{ row: 0, candidates: ['a', 'c'] }])
    expect(resolveMemberImport([row()], roster, { 0: 'c' }).resolved[0].userId).toBe('c')
    for (const id of ['b', 'gone']) {
      const result = resolveMemberImport([row()], roster, { 0: id })
      expect(result.resolved).toEqual([])
      expect(result.conflicts).not.toEqual([])
    }
  })
  it('does not override unknown names or a stale choice on a unique name', () => {
    const unknown = row({ name: 'Not Here' })
    expect(resolveMemberImport([unknown], members, { 0: 'a' }).unknown).toEqual([unknown])
    const result = resolveMemberImport([row()], members, { 0: 'gone' })
    expect(result.resolved).toEqual([])
    expect(result.conflicts).not.toEqual([])
  })
  it('unions repeated source rows and preserves blank fields', () => {
    const result = resolveMemberImport([
      row({ teams: [' Dev '], skills: [' TypeScript '], present: { teams: true, positions: false, skills: true } }),
      row({ source: 'Sheet 2 row 4', teams: ['dev', 'QA'], present: { teams: true, positions: false, skills: false } }),
    ], members, {})
    expect(result.resolved).toHaveLength(1)
    expect(result.resolved[0]).toMatchObject({ userId: 'a', teams: ['Dev', 'QA'], skills: ['TypeScript'], present: { teams: true, positions: false, skills: true } })
    expect(result.resolved[0].sources).toEqual(['Sheet 1 row 2', 'Sheet 2 row 4'])
    expect(result.conflicts).toEqual([])
  })
  it.each(['teams', 'positions', 'skills'] as const)('blocks explicit none conflicting with stated %s in either order', field => {
    const value = field === 'positions' ? [{ team: 'Dev', name: 'Builder', scope: 'team' as const }] : ['Dev']
    const stated = row({ [field]: value, present: { teams: false, positions: false, skills: false, [field]: true } })
    const none = row({ present: { teams: false, positions: false, skills: false, [field]: true } })
    for (const rows of [[stated, none], [none, stated]]) expect(resolveMemberImport(rows, members, {}).conflicts).not.toEqual([])
  })
  it('ignores values in fields marked blank', () => {
    expect(resolveMemberImport([row({ teams: ['Ignored'] })], members, {}).resolved[0]).toMatchObject({ teams: [], present: { teams: false } })
  })
})

function current(patch: Partial<ImportCurrent> = {}): ImportCurrent {
  return {
    members: [{ user_id: 'a', role: 'member' }, { user_id: 'b', role: 'member' }],
    teams: [{ id: 'dev', name: 'Dev', leader_id: null, archived_at: null }, { id: 'ops', name: 'Ops', leader_id: null, archived_at: null }],
    teamMembers: [{ user_id: 'a', team_id: 'dev' }],
    positions: [{ id: 'builder', team_id: 'dev', name: 'Builder' }],
    holders: [{ user_id: 'a', position_id: 'builder' }],
    skills: [{ user_id: 'a', tag: 'TypeScript' }], ...patch,
  }
}
function preview(mode: 'add' | 'replace', patch: Partial<RosterRow> = {}, state = current(), excluded = new Set<string>()) {
  return previewMemberImport(mode, resolveMemberImport([row(patch)], members, {}).resolved, state, excluded)
}
describe('previewMemberImport', () => {
  it('Add unions current values and reuses existing spelling without removals', () => {
    const result = preview('add', { teams: [' ops '], positions: [{ team: ' DEV ', name: ' builder ', scope: 'team' }], skills: ['typescript', 'SQL'], present: { teams: true, positions: true, skills: true } })
    expect(result.blockers).toEqual([])
    expect(result.rows).toEqual([{ user_id: 'a', teams: ['Dev', 'Ops'], positions: [{ team: 'Dev', name: 'Builder' }], skills: ['TypeScript', 'SQL'] }])
    expect(result.members[0].additions).toEqual({ teams: ['Ops'], positions: [], skills: ['SQL'] })
    expect(result.members[0].removals).toEqual({ teams: [], positions: [], skills: [] })
    expect(result.newTeams).toEqual([])
    expect(result.newPositions).toEqual([])
  })
  it('Replace changes only stated fields, including explicit none', () => {
    const result = preview('replace', { skills: [], present: { teams: false, positions: false, skills: true } })
    expect(result.rows).toEqual([{ user_id: 'a', teams: null, positions: null, skills: [] }])
    expect(result.members[0].removals.skills).toEqual(['TypeScript'])
    expect(result.members[0].proposed.teams).toEqual(['Dev'])
  })
  it('leaves excluded and absent members untouched', () => {
    const result = preview('replace', { teams: ['Ops'], present: { teams: true, positions: false, skills: false } }, current(), new Set(['a']))
    expect(result.rows).toEqual([])
    expect(result.members).toEqual([])
    expect(result.expected.members).toEqual([])
    expect(preview('add').expected.members.map(member => member.user_id)).toEqual(['a'])
  })
  it('creates scoped positions once and implies their team membership', () => {
    const result = preview('replace', { positions: [{ team: ' Design ', name: ' Reviewer ', scope: 'team' }, { team: 'design', name: 'reviewer', scope: 'team' }], present: { teams: false, positions: true, skills: false } })
    expect(result.blockers).toEqual([])
    expect(result.newTeams).toEqual(['Design'])
    expect(result.newPositions).toEqual([{ team: 'Design', name: 'Reviewer' }])
    expect(result.rows[0]).toEqual({ user_id: 'a', teams: ['Dev', 'Design'], positions: [{ team: 'Design', name: 'Reviewer' }], skills: null })
  })
  it('allows explicit project-wide positions but blocks unclear scope', () => {
    expect(preview('replace', { positions: [{ team: '', name: 'Advisor', scope: 'project' }], present: { teams: false, positions: true, skills: false } }).rows[0].positions).toEqual([{ team: '', name: 'Advisor' }])
    for (const position of [{ team: '', name: 'Advisor', scope: 'unknown' as const }, { team: '', name: 'Advisor', scope: 'team' as const }, { team: 'Dev', name: 'Advisor', scope: 'project' as const }]) {
      const result = preview('add', { positions: [position], present: { teams: false, positions: true, skills: false } })
      expect(result.blockers).not.toEqual([])
      expect(result.rows).toEqual([])
    }
  })
  it.each(['qa', 'stakeholder'] as const)('blocks skills for %s', role => {
    expect(preview('add', { skills: ['SQL'], present: { teams: false, positions: false, skills: true } }, current({ members: [{ user_id: 'a', role }] })).blockers).not.toEqual([])
  })
  it('checks the final skill union limit and tag length', () => {
    expect(preview('add', { skills: Array.from({ length: 12 }, (_, i) => `Tag ${i}`), present: { teams: false, positions: false, skills: true } }).blockers).not.toEqual([])
    expect(preview('replace', { skills: ['x'.repeat(41)], present: { teams: false, positions: false, skills: true } }).blockers).not.toEqual([])
    expect(preview('replace', { skills: Array.from({ length: 12 }, (_, i) => `Tag ${i}`), present: { teams: false, positions: false, skills: true } }).blockers).toEqual([])
  })
  it('blocks removing a team leader or a team required by an unchanged position', () => {
    const patch = { teams: ['Ops'], present: { teams: true, positions: false, skills: false } }
    expect(preview('replace', patch).blockers.join(' ')).toMatch(/position/i)
    expect(preview('replace', patch, current({ holders: [], teams: [{ id: 'dev', name: 'Dev', leader_id: 'a', archived_at: null }, { id: 'ops', name: 'Ops', leader_id: null, archived_at: null }] })).blockers.join(' ')).toMatch(/leader/i)
    expect(preview('replace', { ...patch, positions: [], present: { teams: true, positions: true, skills: false } }).blockers).toEqual([])
  })
  it('blocks ambiguous team and scoped position catalogs, and archived target teams', () => {
    const patch = { positions: [{ team: 'Dev', name: 'Builder', scope: 'team' as const }], present: { teams: false, positions: true, skills: false } }
    expect(preview('add', patch, current({ positions: [{ id: 'p1', team_id: 'dev', name: 'Builder' }, { id: 'p2', team_id: 'dev', name: 'builder' }] })).blockers).not.toEqual([])
    expect(preview('add', patch, current({ teams: [{ id: 'dev', name: 'Dev', leader_id: null, archived_at: null }, { id: 'other', name: 'DEV', leader_id: null, archived_at: null }] })).blockers).not.toEqual([])
    expect(preview('add', patch, current({ teams: [{ id: 'dev', name: 'Dev', leader_id: null, archived_at: '2026-01-01' }] })).blockers).not.toEqual([])
  })
  it('rejects a resolved member who left the project', () => {
    const result = preview('add', {}, current({ members: [] }))
    expect(result.blockers).not.toEqual([])
    expect(result.rows).toEqual([])
  })
  it('snapshots affected state and complete catalog canonically without names in writes', () => {
    const state = current({ skills: [{ user_id: 'a', tag: '😀' }, { user_id: 'a', tag: 'é' }] })
    const result = preview('add', {}, state)
    expect(result.expected).toEqual({
      members: [{ user_id: 'a', role: 'member', team_ids: ['dev'], position_ids: ['builder'], skills: { '😀': true, 'é': true } }],
      teams: [{ id: 'dev', name: 'Dev', leader_id: null, archived: false }, { id: 'ops', name: 'Ops', leader_id: null, archived: false }],
      positions: [{ id: 'builder', team_id: 'dev', name: 'Builder' }],
    })
    expect(preview('add', {}, { ...state, teams: [...state.teams].reverse(), skills: [...state.skills].reverse() }).expected).toEqual(result.expected)
    expect(JSON.stringify(result.rows)).not.toContain('Alex')
  })
  it('records archived state as a boolean independent of timestamp formatting', () => {
    const state = current()
    state.teams[1].archived_at = '2026-01-01T00:00:00+00:00'
    expect(preview('add', {}, state).expected.teams[1]).toEqual({ id: 'ops', name: 'Ops', leader_id: null, archived: true })
    expect(preview('add').expected.teams[1]).toEqual({ id: 'ops', name: 'Ops', leader_id: null, archived: false })
  })
  it('reuses the exact existing skill spelling in Replace', () => {
    expect(preview('replace', { skills: ['typescript'], present: { teams: false, positions: false, skills: true } }).rows[0].skills).toEqual(['TypeScript'])
  })
  it('deduplicates creations across people but keeps the same position name scoped to different teams', () => {
    const resolved = resolveMemberImport([
      row({ positions: [{ team: 'Design', name: 'Reviewer', scope: 'team' }, { team: 'Ops', name: 'Reviewer', scope: 'team' }], present: { teams: false, positions: true, skills: false } }),
      row({ name: 'Sam Lee', positions: [{ team: 'design', name: 'reviewer', scope: 'team' }], present: { teams: false, positions: true, skills: false } }),
    ], members, {}).resolved
    const result = previewMemberImport('add', resolved, current(), new Set())
    expect(result.blockers).toEqual([])
    expect(result.newTeams).toEqual(['Design'])
    expect(result.newPositions).toEqual([{ team: 'Design', name: 'Reviewer' }, { team: 'Ops', name: 'Reviewer' }])
    expect(result.rows[1]).toEqual({ user_id: 'b', teams: ['Design'], positions: [{ team: 'Design', name: 'Reviewer' }], skills: null })
  })
  it('blocks an ambiguous retained team when writing a union by name', () => {
    const state = current({ teams: [
      { id: 'dev', name: 'Dev', leader_id: null, archived_at: null },
      { id: 'dev2', name: 'dev', leader_id: null, archived_at: null },
      { id: 'ops', name: 'Ops', leader_id: null, archived_at: null },
    ] })
    const result = preview('add', { teams: ['Ops'], present: { teams: true, positions: false, skills: false } }, state)
    expect(result.blockers).not.toEqual([])
    expect(result.rows).toEqual([])
  })
  it('sorts snapshot members and their IDs without changing source arrays', () => {
    const state = current({ teamMembers: [{ user_id: 'a', team_id: 'ops' }, { user_id: 'a', team_id: 'dev' }] })
    const resolved = resolveMemberImport([row({ name: 'Sam Lee' }), row()], members, {}).resolved
    const result = previewMemberImport('add', resolved, state, new Set())
    expect(result.expected.members.map(m => [m.user_id, m.team_ids])).toEqual([['a', ['dev', 'ops']], ['b', []]])
    expect(state.teamMembers.map(m => m.team_id)).toEqual(['ops', 'dev'])
  })
})
