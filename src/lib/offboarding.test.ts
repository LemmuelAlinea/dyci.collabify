import { describe, expect, it } from 'vitest'
import { buildOverrides, handoverLines, isEligibleSuccessor, readyToOffboard } from './offboarding'
import type { OffboardLine } from './offboarding'

const line = (over: Partial<OffboardLine>): OffboardLine => ({
  kind: 'space_pm',
  item_id: 'i1',
  item_name: 'Item',
  project_name: '',
  space_name: 'Space',
  office_name: '',
  archived: false,
  task_count: 0,
  ...over,
})

describe('offboarding helpers', () => {
  it('handoverLines keeps only space and project managers', () => {
    const lines = [line({ kind: 'space_pm' }), line({ kind: 'team_lead' }), line({ kind: 'project_pm' }), line({ kind: 'open_tasks' })]
    expect(handoverLines(lines).map((l) => l.kind)).toEqual(['space_pm', 'project_pm'])
  })

  it('buildOverrides keeps only changed lines', () => {
    const lines = [line({ item_id: 'a' }), line({ item_id: 'b', kind: 'project_pm' }), line({ item_id: 'c', kind: 'project_pm' })]
    expect(buildOverrides(lines, 'S', { a: 'S', b: 'X' })).toEqual({ b: 'X' })
  })

  it('readyToOffboard needs a successor when spaces or projects are listed', () => {
    expect(readyToOffboard([line({})], null)).toBe(false)
    expect(readyToOffboard([line({})], 'S')).toBe(true)
  })

  it('readyToOffboard is true with only tasks and teams', () => {
    expect(readyToOffboard([line({ kind: 'open_tasks' }), line({ kind: 'team_lead' })], null)).toBe(true)
  })

  it('isEligibleSuccessor refuses the target, an admin, an inactive account and someone without Project manager', () => {
    const ok = { id: 'a', role: 'member', status: 'active', can_manage_projects: true }
    expect(isEligibleSuccessor(ok, 't')).toBe(true)
    expect(isEligibleSuccessor(ok, 'a')).toBe(false)
    expect(isEligibleSuccessor({ ...ok, role: 'admin' }, 't')).toBe(false)
    expect(isEligibleSuccessor({ ...ok, status: 'suspended' }, 't')).toBe(false)
    expect(isEligibleSuccessor({ ...ok, can_manage_projects: false }, 't')).toBe(false)
    expect(isEligibleSuccessor(ok, '')).toBe(true)
  })
})
