import { describe, expect, it } from 'vitest'
import { workCalendarEvents } from './workDates'

const name = (id: string) => `Project ${id}`

describe('workCalendarEvents', () => {
  it('excludes a done task, even with a due date', () => {
    const events = workCalendarEvents(
      [{ id: 't1', title: 'Ship it', due_at: '2026-10-01', status: 'done', project_id: 'p1' }],
      name,
    )
    expect(events).toEqual([])
  })

  it('excludes a task with no due date', () => {
    const events = workCalendarEvents(
      [{ id: 't1', title: 'Ship it', due_at: null, status: 'todo', project_id: 'p1' }],
      name,
    )
    expect(events).toEqual([])
  })

  it('shapes an open, dated task as a work calendar event', () => {
    const events = workCalendarEvents(
      [{ id: 't1', title: 'Ship it', due_at: '2026-10-01', status: 'in_progress', project_id: 'p1' }],
      name,
    )
    expect(events).toEqual([
      {
        kind: 'project_due',
        ref_id: 't1',
        title: 'Ship it',
        at: '2026-10-01',
        class_id: '',
        class_initial: '',
        class_name: '',
        project_id: 'p1',
        project_title: 'Project p1',
        task_id: 't1',
        group_name: null,
        done: false,
        late: false,
      },
    ])
  })

  it('keeps every open, dated task, not only the reader\'s own', () => {
    const events = workCalendarEvents(
      [
        { id: 't1', title: 'A', due_at: '2026-10-01', status: 'todo', project_id: 'p1' },
        { id: 't2', title: 'B', due_at: '2026-10-02', status: 'in_progress', project_id: 'p2' },
      ],
      name,
    )
    expect(events.map((e) => e.ref_id)).toEqual(['t1', 't2'])
  })
})
