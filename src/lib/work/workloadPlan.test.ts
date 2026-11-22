import { describe, expect, it } from 'vitest'
import {
  balanceWorkPlan,
  dependencyGroups,
  projectedTotals,
  validateBreakdown,
  type Candidate,
  type PlanRow,
} from '../../../supabase/functions/_shared/workloadPlan.ts'

const person = (id: string, tags: string[], loadMinutes: number, availableMinutes: number | null): Candidate =>
  ({ id, name: id.toUpperCase(), tags, positions: [], loadMinutes, availableMinutes })

const row = (key: string, minutes: number, tags: string[], dependsOn: string[] = []): PlanRow =>
  ({ key, title: key, description: '', minutes, tags, position: null, dependsOn, owner: null, pinned: false })

const team = () => [person('a', ['Auth'], 360, 960), person('b', ['UI'], 240, 960), person('c', ['Testing'], 120, 960)]

const login = () => [
  row('contract', 120, ['Auth']),
  row('page design', 120, ['UI']),
  row('test cases', 180, ['Testing']),
  row('auth', 360, ['Auth'], ['contract']),
  row('interface', 480, ['UI'], ['contract']),
  row('integration', 240, ['Testing'], ['auth', 'interface']),
  row('e2e', 300, ['Testing'], ['integration']),
]

const withOwners = (rows: PlanRow[], people: Candidate[]) => {
  const picks = new Map(balanceWorkPlan(rows, people).map(p => [p.key, p.owner]))
  return rows.map(r => ({ ...r, owner: picks.get(r.key) ?? null }))
}

describe('balanceWorkPlan', () => {
  it('defense split', () => {
    const people = team()
    const picks = balanceWorkPlan(login(), people)
    expect(picks.map(p => p.key)).toEqual(login().map(r => r.key))
    expect(picks.map(p => p.owner)).toEqual(['a', 'b', 'c', 'a', 'b', 'c', 'c'])
    expect(picks.every(p => p.reason === 'fit')).toBe(true)
    expect(picks[0].note).toBe('Only A is tagged Auth.')
    expect(projectedTotals(withOwners(login(), people), people)).toEqual([
      { id: 'a', existing: 360, added: 480, projected: 840, available: 960 },
      { id: 'b', existing: 240, added: 600, projected: 840, available: 960 },
      { id: 'c', existing: 120, added: 720, projected: 840, available: 960 },
    ])
  })

  it('defense groups', () => {
    expect(dependencyGroups(login())).toEqual([
      ['contract', 'page design', 'test cases'],
      ['auth', 'interface'],
      ['integration'],
      ['e2e'],
    ])
  })

  it('bottleneck', () => {
    const people = [person('a', ['Auth'], 600, 720), ...team().slice(1)]
    const picks = balanceWorkPlan(login(), people)
    expect(picks.find(p => p.key === 'auth')).toEqual({
      key: 'auth', owner: null, reason: 'no_room', note: 'Only A is tagged Auth, and has 2 h free.',
    })
    expect(picks.find(p => p.key === 'contract')).toMatchObject({ owner: 'a', reason: 'fit' })
  })

  it('pins kept', () => {
    const people = team()
    const rows = login().map(r => (r.key === 'interface' ? { ...r, owner: 'c', pinned: true } : r))
    const picks = balanceWorkPlan(rows, people)
    expect(picks.find(p => p.key === 'interface')).toMatchObject({ owner: 'c', reason: 'pinned' })
    // C now carries 600 before the rest: integration no longer fits after e2e.
    expect(picks.find(p => p.key === 'auth')).toMatchObject({ owner: 'a', reason: 'fit' })
    expect(picks.find(p => p.key === 'e2e')).toMatchObject({ owner: 'c', reason: 'fit' })
    expect(picks.find(p => p.key === 'integration')).toMatchObject({ owner: null, reason: 'no_room' })
    // A pin to nobody stays empty.
    const empty = balanceWorkPlan(rows.map(r => (r.key === 'auth' ? { ...r, pinned: true } : r)), people)
    expect(empty.find(p => p.key === 'auth')).toMatchObject({ owner: null, reason: 'pinned' })
  })

  it('nobody tagged', () => {
    const picks = balanceWorkPlan([row('deploy', 120, ['DevOps'])], team())
    expect(picks).toEqual([
      { key: 'deploy', owner: 'c', reason: 'fit_untagged', note: 'No one here is tagged with DevOps.' },
    ])
  })

  it('unknown hours', () => {
    const people = [person('a', ['Auth'], 0, null), person('b', ['UI'], 0, 960)]
    expect(balanceWorkPlan([row('auth', 120, ['Auth'])], people)).toEqual([
      { key: 'auth', owner: null, reason: 'unknown_hours', note: 'A has no weekly hours set.' },
    ])
  })

  it('no one to pick from', () => {
    expect(balanceWorkPlan([row('auth', 120, ['Auth'])], [])[0]).toMatchObject({ owner: null, reason: 'no_skill' })
  })

  it('matches tags in any case', () => {
    const people = [person('a', ['auth'], 0, 960), person('b', ['UI'], 0, 960)]
    expect(balanceWorkPlan([row('auth', 120, ['Auth'])], people)[0]).toMatchObject({ owner: 'a', reason: 'fit' })
  })

  it('stable ties', () => {
    const people = [person('b', [], 120, 960), person('a', [], 120, 960)]
    const rows = [row('x', 60, [])]
    const first = balanceWorkPlan(rows, people)
    expect(first[0]).toMatchObject({ owner: 'a', reason: 'fit' })
    expect(balanceWorkPlan(rows, [...people].reverse())).toEqual(first)
    expect(balanceWorkPlan(rows, people)).toEqual(first)
  })
})

describe('validateBreakdown', () => {
  const labels = { tags: ['Auth', 'UI', 'Testing'], positions: ['Developer'] }
  const raw = (rows: unknown[]) => ({ rows })
  const r = (key: string, dependsOn: string[] = [], extra: Record<string, unknown> = {}) =>
    ({ key, title: `Do ${key}`, description: '', minutes: 120, tags: ['Auth'], position: null, dependsOn, ...extra })

  it('accepts a good plan and normalizes labels', () => {
    const out = validateBreakdown(raw([r('a'), r('b', ['a'], { tags: ['auth'], position: 'developer' })]), labels)
    expect(out).toEqual({
      rows: [
        { key: 'a', title: 'Do a', description: '', minutes: 120, tags: ['Auth'], position: null, dependsOn: [], owner: null, pinned: false },
        { key: 'b', title: 'Do b', description: '', minutes: 120, tags: ['Auth'], position: 'Developer', dependsOn: ['a'], owner: null, pinned: false },
      ],
    })
  })

  const errors: [string, unknown, string][] = [
    ['cycle', raw([r('a', ['b']), r('b', ['a'])]), 'circular'],
    ['self link', raw([r('a', ['a']), r('b')]), '"Do a" depends on itself'],
    ['unknown link', raw([r('a', ['zz']), r('b')]), '"Do a" depends on "zz"'],
    ['duplicate key', raw([r('a'), r('a')]), '"Do a" reuses the key "a"'],
    ['unknown tag', raw([r('a', [], { tags: ['DevOps'] }), r('b')]), '"Do a" uses the tag "DevOps"'],
    ['unknown position', raw([r('a', [], { position: 'Chef' }), r('b')]), '"Do a" uses the position "Chef"'],
    ['1 row', raw([r('a')]), '2 to 12'],
    ['13 rows', raw(Array.from({ length: 13 }, (_, i) => r(`k${i}`))), '2 to 12'],
    ['0 minutes', raw([r('a', [], { minutes: 0 }), r('b')]), '"Do a" needs an estimate'],
    ['too many minutes', raw([r('a', [], { minutes: 4801 }), r('b')]), '"Do a" needs an estimate'],
    ['not a plan', 'nope', 'unreadable'],
  ]
  for (const [name, input, needle] of errors) {
    it(`refuses ${name}`, () => {
      const out = validateBreakdown(input, labels)
      expect(out).toHaveProperty('error')
      expect((out as { error: string }).error).toContain(needle)
    })
  }

  it('names a row on the cycle, not one waiting on it', () => {
    const out = validateBreakdown(raw([r('start'), r('a', ['b', 'start']), r('b', ['a']), r('c', ['a'])]), labels)
    expect((out as { error: string }).error).toBe('"Do a" is part of a circular dependency.')
  })
})
