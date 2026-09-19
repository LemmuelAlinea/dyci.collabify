import { describe, expect, it } from 'vitest'
import { dueByWeek, overdueTasks } from './pressure'
import type { PressureTask } from './pressure'

const DAY = 86_400_000
const NOW = new Date('2026-10-29T12:00:00Z').getTime()
const inDays = (n: number) => new Date(NOW + n * DAY).toISOString()

function task(over: Partial<PressureTask> = {}): PressureTask {
  return { id: 't', title: 'A task', status: 'todo', due_at: null, team_id: null, ...over }
}

describe('overdueTasks', () => {
  it('finds an open task past its date', () => {
    const late = task({ id: 'late', due_at: inDays(-2) })
    expect(overdueTasks([late, task({ due_at: inDays(3) })], NOW).map((t) => t.id)).toEqual(['late'])
  })

  it('leaves a finished task alone however late it was', () => {
    expect(overdueTasks([task({ status: 'done', due_at: inDays(-9) })], NOW)).toEqual([])
  })

  it('leaves a task with no date alone', () => {
    expect(overdueTasks([task()], NOW)).toEqual([])
  })

  it('puts the longest overdue first', () => {
    const rows = overdueTasks(
      [
        task({ id: 'a', due_at: inDays(-1) }),
        task({ id: 'c', due_at: inDays(-9) }),
        task({ id: 'b', due_at: inDays(-4) }),
      ],
      NOW,
    )
    expect(rows.map((t) => t.id)).toEqual(['c', 'b', 'a'])
  })

  it('counts a task in progress as overdue too', () => {
    expect(overdueTasks([task({ status: 'in_progress', due_at: inDays(-1) })], NOW)).toHaveLength(1)
  })
})

describe('dueByWeek', () => {
  it('returns one bucket per week asked for', () => {
    expect(dueByWeek([], NOW, 4)).toHaveLength(4)
  })

  it('counts a task in the week it falls due', () => {
    const weeks = dueByWeek([task({ due_at: inDays(2) }), task({ due_at: inDays(9) })], NOW, 4)
    expect(weeks[0].count).toBe(1)
    expect(weeks[1].count).toBe(1)
  })

  it('leaves out anything already overdue', () => {
    expect(dueByWeek([task({ due_at: inDays(-1) })], NOW, 4).every((w) => w.count === 0)).toBe(true)
  })

  it('leaves out anything finished', () => {
    expect(
      dueByWeek([task({ status: 'done', due_at: inDays(2) })], NOW, 4).every((w) => w.count === 0),
    ).toBe(true)
  })

  it('leaves out anything past the window', () => {
    expect(dueByWeek([task({ due_at: inDays(60) })], NOW, 4).every((w) => w.count === 0)).toBe(true)
  })

  it('labels every bucket', () => {
    for (const w of dueByWeek([], NOW, 4)) expect(w.label.length).toBeGreaterThan(0)
  })
})
