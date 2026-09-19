import { describe, expect, it } from 'vitest'
import { describeEvent } from './history'
import type { GeneralTaskEvent } from './types'

const names: Record<string, string> = { a: 'Ana Reyes', b: 'Ben Cruz' }
const nameOf = (id: string) => names[id] ?? 'A former member'

function event(over: Partial<GeneralTaskEvent>): GeneralTaskEvent {
  return {
    id: 'e1',
    task_id: 't1',
    project_id: 'p1',
    actor_id: 'a',
    kind: 'created',
    detail: {},
    created_at: '2026-10-01T00:00:00Z',
    ...over,
  }
}

describe('describeEvent', () => {
  it('names who created the task', () => {
    expect(describeEvent(event({}), nameOf)).toBe('Ana Reyes created this task')
  })

  it('says where a task moved when only its status changed', () => {
    expect(
      describeEvent(event({ kind: 'updated', detail: { fields: ['status'], status: 'in_progress' } }), nameOf),
    ).toBe('Ana Reyes moved it to In progress')
  })

  it('lists the other things that changed in plain words', () => {
    expect(
      describeEvent(event({ kind: 'updated', detail: { fields: ['title', 'due_at', 'weight'] } }), nameOf),
    ).toBe('Ana Reyes changed the title, due date and points')
  })

  it('tells claiming apart from being assigned', () => {
    expect(describeEvent(event({ kind: 'assigned', detail: { user_id: 'a' } }), nameOf)).toBe(
      'Ana Reyes took this task',
    )
    expect(describeEvent(event({ kind: 'assigned', detail: { user_id: 'b' } }), nameOf)).toBe(
      'Ana Reyes assigned it to Ben Cruz',
    )
  })

  it('tells releasing apart from being taken off', () => {
    expect(describeEvent(event({ kind: 'unassigned', detail: { user_id: 'a' } }), nameOf)).toBe(
      'Ana Reyes released this task',
    )
    expect(describeEvent(event({ kind: 'unassigned', detail: { user_id: 'b' } }), nameOf)).toBe(
      'Ana Reyes took Ben Cruz off it',
    )
  })

  it('does not call a multi-field change a move, even when status is one of them', () => {
    expect(
      describeEvent(
        event({ kind: 'updated', detail: { fields: ['status', 'due_at'], status: 'done' } }),
        nameOf,
      ),
    ).toBe('Ana Reyes changed the status and due date')
  })

  it('falls back rather than naming a stage or a field it does not know', () => {
    // `detail` arrives as JSON from the database, so its contents are whatever
    // was written, not whatever the type says. The cast is the point of the test.
    const parked = { fields: ['status'], status: 'parked' } as unknown as GeneralTaskEvent['detail']
    expect(describeEvent(event({ kind: 'updated', detail: parked }), nameOf)).toBe(
      'Ana Reyes moved it to a new stage',
    )
    expect(describeEvent(event({ kind: 'updated', detail: { fields: ['sort'] } }), nameOf)).toBe(
      'Ana Reyes changed the sort',
    )
  })

  it('does not invent a name for a missing actor', () => {
    expect(describeEvent(event({ actor_id: null }), nameOf)).toBe('Somebody created this task')
  })
})

describe('describeEvent says what a change was, not only that it happened', () => {
  it('names both stages when a task moves', () => {
    expect(
      describeEvent(
        event({
          kind: 'updated',
          detail: { fields: ['status'], status: 'done', status_from: 'in_progress' },
        }),
        nameOf,
      ),
    ).toBe('Ana Reyes moved it from In progress to Done')
  })

  it('still reads properly for an event written before the old value was kept', () => {
    expect(
      describeEvent(event({ kind: 'updated', detail: { fields: ['status'], status: 'done' } }), nameOf),
    ).toBe('Ana Reyes moved it to Done')
  })

  it('quotes both titles on a rename', () => {
    expect(
      describeEvent(
        event({
          kind: 'updated',
          detail: { fields: ['title'], title_from: 'Gather requirements', title_to: 'Gather requirements from the client' },
        }),
        nameOf,
      ),
    ).toBe('Ana Reyes renamed it from "Gather requirements" to "Gather requirements from the client"')
  })

  it('shortens a title too long to sit in a log line', () => {
    const long = 'A'.repeat(80)
    const line = describeEvent(
      event({ kind: 'updated', detail: { fields: ['title'], title_from: 'Short', title_to: long } }),
      nameOf,
    )
    expect(line).toContain('…')
    expect(line).not.toContain(long)
  })

  it('reads a due date being set, moved and taken off', () => {
    const at = '2026-10-10T06:00:00Z'
    const later = '2026-10-17T06:00:00Z'
    expect(
      describeEvent(event({ kind: 'updated', detail: { fields: ['due_at'], due_from: null, due_to: at } }), nameOf),
    ).toMatch(/^Ana Reyes set the due date to /)
    expect(
      describeEvent(event({ kind: 'updated', detail: { fields: ['due_at'], due_from: at, due_to: later } }), nameOf),
    ).toMatch(/^Ana Reyes moved the due date from .* to /)
    expect(
      describeEvent(event({ kind: 'updated', detail: { fields: ['due_at'], due_from: at, due_to: null } }), nameOf),
    ).toBe('Ana Reyes took the due date off')
  })

  it('names both numbers when points change', () => {
    expect(
      describeEvent(
        event({ kind: 'updated', detail: { fields: ['weight'], weight_from: 1, weight_to: 5 } }),
        nameOf,
      ),
    ).toBe('Ana Reyes changed the points from 1 to 5')
  })

  it('falls back to the field list when several things changed at once', () => {
    expect(
      describeEvent(
        event({
          kind: 'updated',
          detail: { fields: ['title', 'status'], status: 'done', status_from: 'todo', title_from: 'a', title_to: 'b' },
        }),
        nameOf,
      ),
    ).toBe('Ana Reyes changed the title and status')
  })

  it('does not quote a rename it has no values for', () => {
    expect(describeEvent(event({ kind: 'updated', detail: { fields: ['title'] } }), nameOf)).toBe(
      'Ana Reyes changed the title',
    )
  })
})

describe('describeEvent on a start date', () => {
  it('reads a start being set', () => {
    expect(
      describeEvent(
        event({
          kind: 'updated',
          detail: { fields: ['starts_at'], starts_from: null, starts_to: '2026-10-10T06:00:00Z' },
        }),
        nameOf,
      ),
    ).toMatch(/^Ana Reyes set the start to /)
  })

  it('reads a start moving', () => {
    expect(
      describeEvent(
        event({
          kind: 'updated',
          detail: {
            fields: ['starts_at'],
            starts_from: '2026-10-03T06:00:00Z',
            starts_to: '2026-10-10T06:00:00Z',
          },
        }),
        nameOf,
      ),
    ).toMatch(/^Ana Reyes moved the start from .* to /)
  })

  it('reads a start being taken off', () => {
    expect(
      describeEvent(
        event({
          kind: 'updated',
          detail: { fields: ['starts_at'], starts_from: '2026-10-03T06:00:00Z', starts_to: null },
        }),
        nameOf,
      ),
    ).toBe('Ana Reyes took the start date off')
  })

  it('names the start in a list when several things changed', () => {
    expect(
      describeEvent(
        event({ kind: 'updated', detail: { fields: ['starts_at', 'due_at'] } }),
        nameOf,
      ),
    ).toBe('Ana Reyes changed the start date and due date')
  })
})
