import { describe, expect, it } from 'vitest'
import { backlogItems, rankBetween, rankForMove, sprintItems } from './backlog'
import type { WorkItem } from './types'

const item = (over: Partial<WorkItem>): WorkItem => ({
  id: 'x', title: 'x', status: 'todo', due_at: null, done_at: null, sprint_id: null,
  rank: 0, holders: [], created_at: '2026-10-01T00:00:00Z', ...over,
})

describe('backlogItems', () => {
  it('keeps unfinished tasks in no sprint, top rank first', () => {
    const list = backlogItems([
      item({ id: 'b', rank: 2 }),
      item({ id: 'a', rank: 1 }),
      item({ id: 'done', rank: 0, status: 'done' }),
      item({ id: 'planned', rank: 0, sprint_id: 's1' }),
    ])
    expect(list.map((i) => i.id)).toEqual(['a', 'b'])
  })
  it('breaks a rank tie by age', () => {
    const list = backlogItems([
      item({ id: 'new', rank: 1, created_at: '2026-10-02T00:00:00Z' }),
      item({ id: 'old', rank: 1, created_at: '2026-10-01T00:00:00Z' }),
    ])
    expect(list.map((i) => i.id)).toEqual(['old', 'new'])
  })
})

describe('sprintItems', () => {
  it('lists a sprint\'s tasks, done ones included, by rank', () => {
    const list = sprintItems(
      [item({ id: 'b', sprint_id: 's', rank: 2, status: 'done' }), item({ id: 'a', sprint_id: 's', rank: 1 }), item({ id: 'c' })],
      's',
    )
    expect(list.map((i) => i.id)).toEqual(['a', 'b'])
  })
})

describe('rankBetween', () => {
  it('splits the gap between neighbours', () => expect(rankBetween(1, 2)).toBe(1.5))
  it('goes above the first', () => expect(rankBetween(undefined, 5)).toBe(4))
  it('goes below the last', () => expect(rankBetween(5, undefined)).toBe(6))
  it('starts at zero in an empty list', () => expect(rankBetween(undefined, undefined)).toBe(0))
})

describe('rankForMove', () => {
  const list = [{ rank: 1 }, { rank: 2 }, { rank: 3 }]
  it('moves up between the two above', () => expect(rankForMove(list, 2, -1)).toBe(1.5))
  it('moves to the top', () => expect(rankForMove(list, 1, -1)).toBe(0))
  it('moves down between the two below', () => expect(rankForMove(list, 0, 1)).toBe(2.5))
  it('moves to the bottom', () => expect(rankForMove(list, 1, 1)).toBe(4))
  it('does nothing past either end', () => {
    expect(rankForMove(list, 0, -1)).toBeNull()
    expect(rankForMove(list, 2, 1)).toBeNull()
  })
})
