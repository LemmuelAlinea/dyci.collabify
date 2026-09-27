import { describe, expect, it } from 'vitest'
import { spaceRows } from './spaceRows'
import type { GeneralSpaceSummary } from '../../lib/general/types'

let n = 0
function space(overrides: Partial<GeneralSpaceSummary> = {}): GeneralSpaceSummary {
  n += 1
  return {
    id: `space-${n}`,
    kind: 'work',
    name: `Space ${n}`,
    description: '',
    created_by: null,
    archived_at: null,
    created_at: '',
    updated_at: '',
    class_id: null,
    my_level: 'member',
    member_count: 1,
    project_count: 0,
    archived_count: 0,
    ...overrides,
  }
}

describe('spaceRows', () => {
  it('drops a space the reader is not in, and an archived one', () => {
    const rows = spaceRows([
      space({ id: 'not-mine', my_level: null }),
      space({ id: 'archived', archived_at: '2026-01-01' }),
      space({ id: 'mine' }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['mine'])
  })

  it('drops a class space with no class_id instead of linking to /classes/<spaceId>', () => {
    const rows = spaceRows([
      space({ id: 'orphan', kind: 'education', class_id: null, name: 'Orphan class' }),
      space({ id: 'k1', kind: 'education', class_id: 'class-1', name: 'Real class' }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['k1'])
    expect(rows[0].to).toBe('/classes/class-1')
  })

  it('sorts classes before work, and alphabetically within a kind', () => {
    const rows = spaceRows([
      space({ id: 'w2', kind: 'work', name: 'Zeta' }),
      space({ id: 'w1', kind: 'work', name: 'Alpha' }),
      space({ id: 'c2', kind: 'education', class_id: 'c2', name: 'Zoology' }),
      space({ id: 'c1', kind: 'education', class_id: 'c1', name: 'Algebra' }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['c1', 'c2', 'w1', 'w2'])
  })

  it('sets tone and link per kind', () => {
    const rows = spaceRows([
      space({ id: 'c1', kind: 'education', class_id: 'k1', name: 'Class' }),
      space({ id: 'w1', kind: 'work', name: 'Work' }),
    ])
    expect(rows.find((r) => r.id === 'c1')).toMatchObject({ to: '/classes/k1', tone: 'education' })
    expect(rows.find((r) => r.id === 'w1')).toMatchObject({ to: '/spaces/w1', tone: 'work' })
  })

  it('caps the list at six', () => {
    const classes = Array.from({ length: 10 }, (_, i) =>
      space({ id: `c${i}`, kind: 'education', class_id: `c${i}`, name: `Class ${i}` }),
    )
    const rows = spaceRows(classes)
    expect(rows).toHaveLength(6)
  })

  it('always shows at least two work spaces when the reader has any, even past the cap', () => {
    const classes = Array.from({ length: 8 }, (_, i) =>
      space({ id: `c${i}`, kind: 'education', class_id: `c${i}`, name: `Class ${i}` }),
    )
    const work = Array.from({ length: 3 }, (_, i) => space({ id: `w${i}`, kind: 'work', name: `Work ${i}` }))
    const rows = spaceRows([...classes, ...work])
    expect(rows).toHaveLength(6)
    expect(rows.filter((r) => r.tone === 'work')).toHaveLength(2)
    expect(rows.filter((r) => r.tone === 'education')).toHaveLength(4)
  })

  it('does not reserve work slots that do not exist', () => {
    const classes = Array.from({ length: 8 }, (_, i) =>
      space({ id: `c${i}`, kind: 'education', class_id: `c${i}`, name: `Class ${i}` }),
    )
    const rows = spaceRows(classes)
    expect(rows).toHaveLength(6)
    expect(rows.every((r) => r.tone === 'education')).toBe(true)
  })
})
