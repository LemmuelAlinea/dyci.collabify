import { describe, expect, it } from 'vitest'
import { classRows, workSpaceRows } from './spaceRows'
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

describe('classRows', () => {
  it('lists only class spaces the reader is in and not archived', () => {
    const rows = classRows([
      space({ id: 'not-mine', kind: 'education', class_id: 'a', my_level: null }),
      space({ id: 'archived', kind: 'education', class_id: 'b', archived_at: '2026-01-01' }),
      space({ id: 'work', kind: 'work' }),
      space({ id: 'mine', kind: 'education', class_id: 'c' }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['mine'])
  })

  it('drops a class space with no class_id instead of linking to /classes/<spaceId>', () => {
    const rows = classRows([
      space({ id: 'orphan', kind: 'education', class_id: null, name: 'Orphan class' }),
      space({ id: 'k1', kind: 'education', class_id: 'class-1', name: 'Real class' }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['k1'])
    expect(rows[0]).toMatchObject({ to: '/classes/class-1', tone: 'education' })
  })

  it('sorts by name and caps at six', () => {
    const rows = classRows(
      Array.from({ length: 10 }, (_, i) =>
        space({ id: `c${9 - i}`, kind: 'education', class_id: `c${i}`, name: `Class ${9 - i}` }),
      ),
    )
    expect(rows.map((r) => r.id)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5'])
  })
})

describe('workSpaceRows', () => {
  it('lists only work spaces the reader is in and not archived', () => {
    const rows = workSpaceRows([
      space({ id: 'not-mine', my_level: null }),
      space({ id: 'archived', archived_at: '2026-01-01' }),
      space({ id: 'class', kind: 'education', class_id: 'k' }),
      space({ id: 'mine' }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['mine'])
    expect(rows[0]).toMatchObject({ to: '/spaces/mine', tone: 'work' })
  })

  it('sorts by name and caps at six', () => {
    const rows = workSpaceRows([
      space({ id: 'z', name: 'Zeta' }),
      space({ id: 'a', name: 'Alpha' }),
      ...Array.from({ length: 8 }, (_, i) => space({ id: `m${i}`, name: `Mid ${i}` })),
    ])
    expect(rows).toHaveLength(6)
    expect(rows[0].id).toBe('a')
    expect(rows.map((r) => r.id)).not.toContain('z')
  })
})
