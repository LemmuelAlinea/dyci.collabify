import { describe, expect, it } from 'vitest'
import { payloadSummary, templatePayload } from './templates'
import type { GeneralTask } from './types'

const task = (over: Partial<GeneralTask>): GeneralTask =>
  ({
    id: 'x', project_id: 'p', team_id: null, title: 't', description: '', status: 'todo',
    due_at: null, starts_at: null, weight: 1, created_by: null, completed_at: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '', assignee_ids: [], comment_count: 0,
    file_count: 0, logged_minutes: 0, archived_at: null, archived_by: null, ...over,
  }) as GeneralTask

describe('templatePayload', () => {
  it('keeps structure, drops archived tasks, names teams, orders by date', () => {
    const p = templatePayload({
      fields: [{ id: 'f', project_id: 'p', name: 'Venue', type: 'short_text', options: [], sort: 0, created_at: '' }],
      teams: [{ id: 'tm', project_id: 'p', name: 'Logistics', created_at: '' }],
      positions: [{ id: 'ps', project_id: 'p', team_id: 'tm', name: 'Head', sort: 0, created_at: '' }],
      tasks: [
        task({ id: 'b', title: 'Later', due_at: '2026-03-01T00:00:00Z', team_id: 'tm' }),
        task({ id: 'a', title: 'Sooner', due_at: '2026-02-01T00:00:00Z' }),
        task({ id: 'c', title: 'Gone', archived_at: '2026-01-02T00:00:00Z' }),
      ],
    })
    expect(p.tasks.map((t) => t.title)).toEqual(['Sooner', 'Later'])
    expect(p.tasks[1].team).toBe('Logistics')
    expect(p.positions).toEqual([{ name: 'Head', team: 'Logistics' }])
    expect(payloadSummary(p)).toBe('1 field · 1 team · 1 position · 2 tasks')
  })
})
