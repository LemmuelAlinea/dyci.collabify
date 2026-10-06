import { describe, expect, it } from 'vitest'
import { milestoneCalendarEvents, sprintCalendarEvents, taskCalendarEvents } from './calendar'

const task = (over: Partial<{ id: string; title: string; status: 'todo' | 'in_progress' | 'done'; due_at: string | null; late: boolean }> = {}) => ({
  id: 't1',
  title: 'Draw the ERD',
  status: 'todo' as const,
  due_at: '2026-10-10T09:00:00Z',
  ...over,
})

describe('taskCalendarEvents', () => {
  it('turns a dated task into a task_due event that opens the task', () => {
    const [e] = taskCalendarEvents([task()])
    expect(e.kind).toBe('task_due')
    expect(e.ref_id).toBe('t1')
    expect(e.task_id).toBe('t1')
    expect(e.at).toBe('2026-10-10T09:00:00Z')
    expect(e.title).toBe('Draw the ERD')
    expect(e.class_id).toBe('')
  })

  it('leaves out tasks with no due date', () => {
    expect(taskCalendarEvents([task({ due_at: null })])).toEqual([])
  })

  it('keeps finished tasks, marked done', () => {
    const [e] = taskCalendarEvents([task({ status: 'done' })])
    expect(e.done).toBe(true)
  })

  it('marks late only on finished tasks stamped late', () => {
    expect(taskCalendarEvents([task({ status: 'done', late: true })])[0].late).toBe(true)
    expect(taskCalendarEvents([task({ status: 'todo', late: true })])[0].late).toBe(false)
  })

  it('writes the label under the title when one is given', () => {
    const [e] = taskCalendarEvents([task()], () => 'Group 2')
    expect(e.project_title).toBe('Group 2')
  })
})

describe('sprintCalendarEvents', () => {
  it('marks where each sprint starts and ends, opening no task', () => {
    const events = sprintCalendarEvents([
      { id: 's1', name: 'Sprint 1', starts_on: '2026-10-05', ends_on: '2026-10-18', state: 'active' },
    ])
    expect(events.map((e) => [e.kind, e.title, e.task_id])).toEqual([
      ['sprint_start', 'Sprint 1 starts', null],
      ['sprint_end', 'Sprint 1 ends', null],
    ])
    const start = new Date(events[0].at)
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 9, 5])
  })

  it('shows a passed start as done, and an end once the sprint is finished', () => {
    const [start, end] = sprintCalendarEvents([
      { id: 's1', name: 'S', starts_on: '2026-10-05', ends_on: '2026-10-18', state: 'active' },
    ])
    expect(start.done).toBe(true)
    expect(end.done).toBe(false)
  })

  it("leaves a planned sprint's start open, and closes a finished sprint's end", () => {
    const [plannedStart] = sprintCalendarEvents([
      { id: 's2', name: 'S2', starts_on: '2026-10-19', ends_on: '2026-11-01', state: 'planned' },
    ])
    expect(plannedStart.done).toBe(false)
    const [, finishedEnd] = sprintCalendarEvents([
      { id: 's0', name: 'S0', starts_on: '2026-09-21', ends_on: '2026-10-04', state: 'completed' },
    ])
    expect(finishedEnd.done).toBe(true)
  })
})

describe('milestoneCalendarEvents', () => {
  it('puts each milestone on its day, opening no task', () => {
    const [e] = milestoneCalendarEvents([
      { id: 'm1', name: 'Beta', due_on: '2026-10-16', reached_at: null },
    ])
    expect([e.kind, e.title, e.task_id, e.done]).toEqual(['milestone', 'Beta', null, false])
    const at = new Date(e.at)
    expect([at.getFullYear(), at.getMonth(), at.getDate()]).toEqual([2026, 9, 16])
  })
  it('lets the caller decide which milestones are done', () => {
    const m = { id: 'm', name: 'B', due_on: '2026-10-16', reached_at: null }
    expect(milestoneCalendarEvents([m], () => true)[0].done).toBe(true)
    expect(milestoneCalendarEvents([{ ...m, reached_at: '2026-10-10T00:00:00Z' }], () => false)[0].done).toBe(false)
  })
  it('shows a reached milestone as done', () => {
    expect(milestoneCalendarEvents([{ id: 'm', name: 'B', due_on: '2026-10-16', reached_at: '2026-10-10T00:00:00Z' }])[0].done).toBe(true)
  })
})
