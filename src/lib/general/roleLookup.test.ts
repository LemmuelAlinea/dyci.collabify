import { describe, expect, it } from 'vitest'
import { roleLookup } from './roleLookup'

const people = [
  { user_id: 'pm', role: 'pm' as const, level: 'owner' as const },
  { user_id: 'co', role: 'coordinator' as const, level: 'manager' as const },
  { user_id: 'mem', role: 'member' as const, level: 'member' as const },
  { user_id: 'qa', role: 'qa' as const, level: 'member' as const },
  // A class board's Files project: a manager whose role is still member.
  { user_id: 'legacy', role: 'member' as const, level: 'manager' as const },
  { user_id: 'old', level: 'owner' as const },
]

describe('roleLookup', () => {
  const { roleOf, isLead } = roleLookup(people, [
    { leader_id: 'mem' },
    { leader_id: null },
  ])

  it('reads each person\'s role', () => {
    expect(roleOf('pm')).toBe('pm')
    expect(roleOf('co')).toBe('coordinator')
    expect(roleOf('qa')).toBe('qa')
  })
  it('reads a class board manager as a coordinator', () => expect(roleOf('legacy')).toBe('coordinator'))
  it('falls back to the level when a row has no role', () => expect(roleOf('old')).toBe('pm'))
  it('is null for somebody who is not on the project', () => expect(roleOf('ghost')).toBeNull())
  it('knows who leads a team', () => {
    expect(isLead('mem')).toBe(true)
    expect(isLead('pm')).toBe(false)
    expect(isLead('')).toBe(false)
  })
})
