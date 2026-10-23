import { describe, expect, it } from 'vitest'
import { filterByTeam, initialTeamFilter, teamSelection } from './teamFilter'

const task = (id: string, holderIds?: string[], teamId?: string | null) => ({ id, holderIds, teamId })
const read = (t: { holderIds?: string[]; teamId?: string | null }) => ({ teamId: t.teamId, holders: t.holderIds })

describe('filterByTeam', () => {
  const rows = [
    task('held', ['u1'], null),
    task('held-two', ['u2', 'u9'], 'other'),
    task('filed', [], 't1'),
    task('filed-held-elsewhere', ['u9'], 't1'),
    task('neither', ['u3'], 'other'),
    task('unheld', [], null),
    task('bare'),
  ]
  const team = { id: 't1', memberIds: ['u1', 'u2'] }

  it('keeps a task filed under the team that no member holds', () => {
    expect(filterByTeam(rows, team, read).map((r) => r.id)).toContain('filed')
    expect(filterByTeam(rows, team, read).map((r) => r.id)).toContain('filed-held-elsewhere')
  })

  it('keeps a task filed elsewhere but held by a member', () => {
    expect(filterByTeam(rows, team, read).map((r) => r.id)).toEqual(['held', 'held-two', 'filed', 'filed-held-elsewhere'])
  })

  it('drops a task neither filed under the team nor held by a member', () => {
    const ids = filterByTeam(rows, team, read).map((r) => r.id)
    expect(ids).not.toContain('neither')
    expect(ids).not.toContain('unheld')
    expect(ids).not.toContain('bare')
  })

  it('keeps everything for All teams', () => {
    expect(filterByTeam(rows, null, read)).toBe(rows)
  })

  it('keeps only tasks filed under a team with no members', () => {
    expect(filterByTeam(rows, { id: 't1', memberIds: [] }, read).map((r) => r.id)).toEqual(['filed', 'filed-held-elsewhere'])
  })
})

describe('teamSelection', () => {
  const links = [
    { team_id: 't1', user_id: 'u1' },
    { team_id: 't1', user_id: 'u2' },
    { team_id: 't2', user_id: 'u3' },
  ]
  it("lists one team's people", () => expect(teamSelection(links, 't1')).toEqual({ id: 't1', memberIds: ['u1', 'u2'] }))
  it('is null for All teams', () => expect(teamSelection(links, '')).toBeNull())
})

describe('initialTeamFilter', () => {
  const teams = [
    { id: 't1', leader_id: 'boss' },
    { id: 't2', leader_id: 'me' },
  ]
  it('opens a lead on their team the first time', () => {
    expect(initialTeamFilter(null, teams, 'me')).toBe('t2')
  })
  it('opens everybody else on All teams', () => {
    expect(initialTeamFilter(null, teams, 'other')).toBe('')
    expect(initialTeamFilter(null, teams, undefined)).toBe('')
  })
  it('keeps a remembered team', () => expect(initialTeamFilter('t1', teams, 'me')).toBe('t1'))
  it('keeps a remembered All teams, even for a lead', () => {
    expect(initialTeamFilter('', teams, 'me')).toBe('')
  })
  it('falls back when the remembered team is gone', () => {
    expect(initialTeamFilter('gone', teams, 'other')).toBe('')
    expect(initialTeamFilter('gone', teams, 'me')).toBe('t2')
  })
})
