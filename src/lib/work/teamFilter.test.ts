import { describe, expect, it } from 'vitest'
import { filterByTeam, initialTeamFilter, teamMemberIds } from './teamFilter'

const task = (id: string, holderIds?: string[]) => ({ id, holderIds })
const by = (t: { holderIds?: string[] }) => t.holderIds

describe('filterByTeam', () => {
  const rows = [task('a', ['u1']), task('b', ['u2', 'u9']), task('c', ['u3']), task('d', []), task('e')]

  it('keeps tasks held by any team member and drops the rest', () => {
    expect(filterByTeam(rows, ['u1', 'u2'], by).map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('drops tasks nobody holds when a team is chosen', () => {
    expect(filterByTeam(rows, ['u3'], by).map((r) => r.id)).toEqual(['c'])
  })

  it('keeps everything for All teams', () => {
    expect(filterByTeam(rows, null, by)).toBe(rows)
  })

  it('keeps nothing for a team with no members', () => {
    expect(filterByTeam(rows, [], by)).toEqual([])
  })
})

describe('teamMemberIds', () => {
  const links = [
    { team_id: 't1', user_id: 'u1' },
    { team_id: 't1', user_id: 'u2' },
    { team_id: 't2', user_id: 'u3' },
  ]
  it('lists one team\'s people', () => expect(teamMemberIds(links, 't1')).toEqual(['u1', 'u2']))
  it('is null for All teams', () => expect(teamMemberIds(links, '')).toBeNull())
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
