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
