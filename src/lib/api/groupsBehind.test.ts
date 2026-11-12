import { describe, expect, it, vi } from 'vitest'

vi.mock('../supabase', () => ({ supabase: {} }))

import { groupsBehind } from './dashboard'
import type { BoardSummary } from '../types'

const DAY = 86_400_000

function board(id: string, over: Partial<BoardSummary> = {}): BoardSummary {
  return {
    id,
    project_id: 'p1',
    group_id: `g-${id}`,
    task_count: 4,
    done_count: 1,
    done_pct: 25,
    late_count: 0,
    last_activity: new Date().toISOString(),
    ...over,
  } as BoardSummary
}

describe('groupsBehind', () => {
  it('is empty when every group is moving and on time', () => {
    expect(groupsBehind([board('a'), board('b')])).toEqual([])
  })

  it('takes stalled groups, then groups with late tasks, once each', () => {
    const quiet = board('quiet', { last_activity: new Date(Date.now() - 10 * DAY).toISOString() })
    const late = board('late', { late_count: 2 })
    const both = board('both', { task_count: 0, done_count: 0, done_pct: 0, late_count: 1 })
    const rows = groupsBehind([late, quiet, both, board('fine')])
    expect(rows.map((r) => r.id)).toEqual(['quiet', 'both', 'late'])
    expect(rows.find((r) => r.id === 'late')).toMatchObject({ reason: null, late_count: 2 })
    expect(rows.find((r) => r.id === 'both')).toMatchObject({ reason: 'empty', late_count: 1 })
  })

  it('leaves out a finished board, late tasks or not', () => {
    expect(groupsBehind([board('done', { done_pct: 100, done_count: 4, late_count: 3 })])).toEqual([])
  })

  it('shows at most five', () => {
    const many = Array.from({ length: 8 }, (_, i) => board(`l${i}`, { late_count: i + 1 }))
    const rows = groupsBehind(many)
    expect(rows).toHaveLength(5)
    expect(rows[0].late_count).toBe(8)
  })
})
