import { describe, expect, it } from 'vitest'
import {
  balanceWorkPlan,
  breakdownRowProperties,
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
    expect(picks.find(p => p.key === 'integration')).toEqual({
      key: 'integration', owner: null, reason: 'no_room', note: 'Only C is tagged Testing, and has 1 h free.',
    })
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

  it('a partial match takes over once the full match fills up', () => {
    const ivan = { ...person('i', ['React', 'Tailwind CSS', 'UI'], 0, 2400), positions: ['Junior dev'] }
    const wilson = { ...person('w', ['React', 'TypeScript'], 0, 2400), positions: ['Junior dev'] }
    const keneth = { ...person('k', ['Backend'], 0, 2400), positions: [] }
    const ui = (key: string) => ({ ...row(key, 300, ['React', 'Tailwind CSS', 'UI']), position: 'Junior dev' })
    const picks = balanceWorkPlan([ui('r1'), ui('r2'), ui('r3'), ui('r4')], [ivan, wilson, keneth])
    // Ivan fits all four labels, Wilson two (Junior dev, React), Keneth none.
    expect(picks.map(p => p.owner)).toEqual(['i', 'i', 'w', 'i'])
    expect(picks[0]).toMatchObject({ reason: 'fit', note: 'Only I holds Junior dev and is tagged React and Tailwind CSS and UI.' })
    expect(picks[2]).toEqual({
      key: 'r3', owner: 'w', reason: 'fit_partial',
      note: 'W holds Junior dev and is tagged React and has more room than I.',
    })
  })

  it('a partial match never goes past their hours', () => {
    const ivan = person('i', ['UI', 'React'], 0, 2400)
    const wilson = person('w', ['React'], 0, 120)
    const picks = balanceWorkPlan([row('r1', 300, ['UI', 'React']), row('r2', 300, ['UI', 'React'])], [ivan, wilson])
    expect(picks.map(p => p.owner)).toEqual(['i', 'i'])
  })

  it('the closest match with room when nobody fits fully', () => {
    const picks = balanceWorkPlan([row('r1', 120, ['UI', 'React'])], [person('w', ['React'], 0, 960), person('k', [], 0, 960)])
    expect(picks[0]).toEqual({
      key: 'r1', owner: 'w', reason: 'fit_partial', note: 'W is tagged React, the closest match with room.',
    })
  })

  it('spreads a landing page across the people who can do it', () => {
    const dev = (id: string, positions: string[], tags: string[], load: number, available: number) =>
      ({ ...person(id, tags, load, available), positions })
    const people = [
      dev('ivan', ['Junior dev'], ['Accessibility', 'Figma', 'React', 'Responsive design', 'Tailwind CSS', 'UI'], 0, 2400),
      dev('keneth', ['Junior dev'], ['Backend', 'Node.js', 'Supabase', 'Testing'], 360, 2400),
      dev('lemmuel', [], ['Code review', 'Deployment', 'Full-stack'], 0, 768),
      dev('luke', [], ['Code review', 'Planning', 'React', 'UX research'], 0, 2400),
      dev('wilson', ['Junior dev'], ['Auth', 'Forms', 'React', 'Supabase', 'TypeScript'], 0, 2160),
    ]
    const job = (key: string, hours: number, tags: string[], position: string | null = 'Junior dev') =>
      ({ ...row(key, hours * 60, tags), position })
    const rows = [
      job('outline', 2, ['Planning', 'UX research']),
      job('scaffold', 3, ['React', 'Tailwind CSS', 'TypeScript']),
      job('header', 4, ['React', 'Tailwind CSS', 'UI']),
      job('features', 5, ['React', 'Tailwind CSS', 'UI']),
      job('responsive', 4, ['Tailwind CSS', 'Responsive design', 'Accessibility']),
      job('contact', 3, ['React', 'Forms']),
      job('pricing', 3, ['React', 'Tailwind CSS', 'UI']),
      job('qa', 3.5, ['Testing']),
      job('deploy', 3, ['Deployment'], null),
    ]
    const owners = Object.fromEntries(balanceWorkPlan(rows, people).map(p => [p.key, p.owner]))
    expect(owners).toEqual({
      outline: 'luke', scaffold: 'wilson', header: 'ivan', features: 'ivan', responsive: 'ivan',
      contact: 'wilson', pricing: 'luke', qa: 'keneth', deploy: 'lemmuel',
    })
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

describe('breakdownRowProperties', () => {
  it('fixes tags and position to the project labels', () => {
    const props = breakdownRowProperties(['Auth', 'UI'], ['p1', 'p2'])
    expect(props.tags).toEqual({ type: 'array', items: { type: 'string', enum: ['Auth', 'UI'] } })
    expect(props.position).toEqual({ type: 'string', enum: ['', 'p1', 'p2'] })
  })

  it('leaves out tags and position when the project has none', () => {
    const props = breakdownRowProperties([], [])
    expect(Object.keys(props)).toEqual(['key', 'title', 'description', 'minutes', 'depends_on'])
  })

  it('a draft without the left-out fields still validates', () => {
    const out = validateBreakdown(
      { rows: [
        { key: 'a', title: 'Do a', description: '', minutes: 60, depends_on: [] },
        { key: 'b', title: 'Do b', description: '', minutes: 60, depends_on: ['a'] },
      ].map(({ depends_on, ...r }) => ({ ...r, tags: undefined, position: null, dependsOn: depends_on })) },
      { tags: [], positions: [] },
    )
    expect('rows' in out && out.rows.map(r => r.tags)).toEqual([[], []])
  })
})
