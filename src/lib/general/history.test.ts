import { describe, expect, it } from 'vitest'
import { ACTIVITY_KINDS, describeActivity, describeEvent, describeHistory, foldActivity } from './history'
import type { ActivityEvent } from './history'
import type { GeneralTaskEvent } from './types'
import type { ActivityRow } from '../api/generalReports'

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
  it('names handoffs and keeps their reason', () => {
    for (const [kind, words] of [
      ['sent_to_coordinator', 'sent it to a coordinator'],
      ['sent_to_team', 'sent it to a team'],
      ['returned', 'returned it to planning'],
      ['rerouted', 'rerouted it to another team'],
    ] as const) {
      expect(describeEvent(event({ kind, detail: { reason: 'Capacity changed' } }), nameOf)).toBe(`Ana Reyes ${words}: Capacity changed`)
      expect(describeActivity({ kind, actor_name: 'Ana Reyes', subject_name: null, task_title: 'Report', detail: { reason: 'Capacity changed' } })).toBe(`Ana Reyes ${words.replace('it', '"Report"')}: Capacity changed`)
    }
  })
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

function activity(over: Partial<ActivityEvent>): ActivityEvent {
  return {
    kind: 'member_role',
    actor_name: 'Ben Cruz',
    subject_name: 'Ana',
    task_title: null,
    detail: {},
    ...over,
  }
}

describe('describeEvent on QA', () => {
  it('says QA passed it', () => {
    expect(describeEvent(event({ kind: 'qa_passed' }), nameOf)).toBe('Ana Reyes passed it')
  })

  it('says QA sent it back, with the note', () => {
    expect(
      describeEvent(event({ kind: 'qa_sent_back', detail: { note: 'The form loses its data on refresh.' } }), nameOf),
    ).toBe('Ana Reyes sent it back: The form loses its data on refresh.')
  })

  it('still reads when the note is missing', () => {
    expect(describeEvent(event({ kind: 'qa_sent_back' }), nameOf)).toBe('Ana Reyes sent it back')
  })

  it('keeps a long note to one line', () => {
    const line = describeEvent(event({ kind: 'qa_sent_back', detail: { note: 'x'.repeat(500) } }), nameOf)
    expect(line.length).toBeLessThan(160)
    expect(line.endsWith('…')).toBe(true)
  })
})

describe('describeActivity on QA', () => {
  it('names the task QA passed or sent back', () => {
    expect(describeActivity(activity({ kind: 'qa_passed', task_title: 'Login' }))).toBe('Ben Cruz passed "Login"')
    expect(describeActivity(activity({ kind: 'qa_sent_back', task_title: 'Login' }))).toBe('Ben Cruz sent "Login" back')
  })
})

describe('describeActivity on project roles', () => {
  it('says what role somebody now has, in the role labels', () => {
    expect(describeActivity(activity({ detail: { from: 'member', to: 'coordinator' } }))).toBe(
      'Ana is now a coordinator',
    )
    expect(describeActivity(activity({ detail: { from: 'coordinator', to: 'member' } }))).toBe(
      'Ana is now a member',
    )
    expect(describeActivity(activity({ detail: { from: 'member', to: 'pm' } }))).toBe(
      'Ana is now the project manager',
    )
    expect(describeActivity(activity({ detail: { from: 'member', to: 'qa' } }))).toBe('Ana is now QA')
  })

  it('names who handed the project to whom', () => {
    expect(
      describeActivity(activity({ kind: 'pm_handover', actor_name: 'Ben', subject_name: 'Ana' })),
    ).toBe('Ben handed the project to Ana')
  })

  it('names the team a new leader leads', () => {
    expect(
      describeActivity(
        activity({ kind: 'team_leader', detail: { team_id: 't', team_name: 'Design', from: null, to: 'a' } }),
      ),
    ).toBe('Ana now leads Design')
  })

  it('says when a team is left with no leader', () => {
    expect(
      describeActivity(
        activity({ kind: 'team_leader', detail: { team_id: 't', team_name: 'Design', from: 'a', to: null } }),
      ),
    ).toBe('Design has no leader')
  })

  it('reads a leader change written before the team name was kept', () => {
    expect(
      describeActivity(activity({ kind: 'team_leader', detail: { team_id: 't', from: null, to: 'a' } })),
    ).toBe('Ana now leads a team')
    expect(
      describeActivity(activity({ kind: 'team_leader', detail: { team_id: 't', from: 'a', to: null } })),
    ).toBe('A team has no leader')
  })

  it('keeps the old level wording for rows from before roles', () => {
    expect(
      describeActivity(activity({ kind: 'member_level', subject_name: 'Ana', detail: { to: 'manager' } })),
    ).toBe('Ben Cruz made Ana a Manager')
  })

  it('offers the new kinds in the people filter', () => {
    const people = ACTIVITY_KINDS.find((k) => k.label === 'Project and people')?.kinds ?? []
    for (const kind of ['member_role', 'pm_handover', 'team_leader']) expect(people).toContain(kind)
  })
})

describe('history lines for rule changes', () => {
  const rule = (detail: Record<string, unknown>) =>
    event({ id: 'r1', actor_id: null, kind: 'rule_applied', created_at: '2026-11-01T01:00:00Z', detail: { rule_id: 'x', rule_name: 'Tell QA', ...detail } as never })

  it('says what a rule did and names the rule', () => {
    const line = (detail: Record<string, unknown>) => describeEvent(rule(detail), nameOf)
    expect(line({ action: 'move_stage', stage: 'Review', stage_from: 'Doing' })).toBe('Moved it from Doing to Review by the rule “Tell QA”')
    expect(line({ action: 'move_stage', stage: 'Review' })).toBe('Moved it to Review by the rule “Tell QA”')
    expect(line({ action: 'set_priority', priority: 'urgent', priority_from: 'low' })).toBe('Set the priority to Urgent by the rule “Tell QA”')
    expect(line({ action: 'assign', user_id: 'b' })).toBe('Assigned it to Ben Cruz by the rule “Tell QA”')
    expect(line({ action: 'notify', notify_to: 'team_lead', recipients: 1 })).toBe('Notified the team lead by the rule “Tell QA”')
    expect(line({ action: 'notify', notify_to: 'planners', recipients: 2 })).toBe('Notified the project manager and coordinators by the rule “Tell QA”')
    expect(line({ action: 'notify', notify_to: 'holders', recipients: 1 })).toBe("Notified the task's holders by the rule “Tell QA”")
    expect(line({ action: 'notify', notify_to: 'qa', recipients: 1 })).toBe('Notified QA by the rule “Tell QA”')
    expect(line({ action: 'notify', notify_to: 'person', recipients: 1 })).toBe('Notified one person by the rule “Tell QA”')
  })

  it('folds the null-actor row a writing rule leaves into the rule line, so nobody is Somebody', () => {
    const moved = event({ id: 'u1', actor_id: null, kind: 'updated', created_at: '2026-11-01T01:00:00Z', detail: { fields: ['status'], status: 'in_progress' } })
    const lines = describeHistory([moved, rule({ action: 'move_stage', stage: 'Review' })], nameOf)
    expect(lines.map((l) => l.id)).toEqual(['r1'])
    expect(lines[0].text).toBe('Moved it to Review by the rule “Tell QA”')

    const given = event({ id: 'u2', actor_id: null, kind: 'assigned', created_at: '2026-11-01T01:00:00Z', detail: { user_id: 'b' } })
    expect(describeHistory([given, rule({ action: 'assign', user_id: 'b' })], nameOf).map((l) => l.id)).toEqual(['r1'])

    const priority = event({ id: 'u3', actor_id: null, kind: 'updated', created_at: '2026-11-01T01:00:00Z', detail: { fields: ['priority'] } })
    expect(describeHistory([priority, rule({ action: 'set_priority', priority: 'high' })], nameOf).map((l) => l.id)).toEqual(['r1'])
  })

  it('folds nothing into a notify rule, which changes nothing on the task', () => {
    const moved = event({ id: 'u1', actor_id: null, kind: 'updated', created_at: '2026-11-01T01:00:00Z', detail: { fields: ['status'], status: 'in_progress' } })
    const given = event({ id: 'u2', actor_id: null, kind: 'assigned', created_at: '2026-11-01T01:00:00Z', detail: { user_id: 'b' } })
    const lines = describeHistory([moved, given, rule({ action: 'notify', notify_to: 'qa', recipients: 1 })], nameOf)
    expect(lines.map((l) => l.id)).toEqual(['u1', 'u2', 'r1'])
  })

  it('folds only the row the rule action writes, one per rule', () => {
    const moved = event({ id: 'u1', actor_id: null, kind: 'updated', created_at: '2026-11-01T01:00:00Z', detail: { fields: ['status'], status: 'in_progress' } })
    const off = event({ id: 'u2', actor_id: null, kind: 'unassigned', created_at: '2026-11-01T01:00:00Z', detail: { user_id: 'a' } })
    const toAna = event({ id: 'u3', actor_id: null, kind: 'assigned', created_at: '2026-11-01T01:00:00Z', detail: { user_id: 'a' } })
    const toBen = event({ id: 'u4', actor_id: null, kind: 'assigned', created_at: '2026-11-01T01:00:00Z', detail: { user_id: 'b' } })
    const lines = describeHistory([moved, off, toAna, toBen, rule({ action: 'assign', user_id: 'b' })], nameOf)
    expect(lines.map((l) => l.id)).toEqual(['u1', 'u2', 'u3', 'r1'])
  })

  it('keeps a null-actor row that no rule explains, and rows at other times, on other tasks or by a person', () => {
    const stray = event({ id: 'u1', actor_id: null, kind: 'updated', created_at: '2026-11-01T02:00:00Z', detail: { fields: ['status'], status: 'done' } })
    const other = event({ id: 'u2', actor_id: null, kind: 'updated', task_id: 't2', created_at: '2026-11-01T01:00:00Z', detail: { fields: ['status'], status: 'done' } })
    const person = event({ id: 'u3', actor_id: 'a', kind: 'updated', created_at: '2026-11-01T01:00:00Z', detail: { fields: ['status'], status: 'done' } })
    const lines = describeHistory([stray, other, person, rule({ action: 'move_stage', stage: 'Review' })], nameOf)
    expect(lines.map((l) => l.id)).toEqual(['u1', 'u2', 'u3', 'r1'])
    expect(lines[0].text).toBe('Somebody moved it to Done')
  })
})

describe('report lines for rule changes', () => {
  const row = (over: Partial<ActivityRow>): ActivityRow => ({
    at: '2026-11-01T01:00:00Z', id: 'x', project_id: 'p1', actor_id: null, actor_name: null, subject_id: null,
    subject_name: null, kind: 'rule_applied', task_id: 't1', task_title: 'Login', detail: {}, total: 0, ...over,
  })
  const rule = (detail: Record<string, unknown>) => row({ id: 'r1', detail: { rule_id: 'x', rule_name: 'Tell QA', ...detail } })

  it('says what a rule did to which task and names the rule', () => {
    const line = (detail: Record<string, unknown>, over: Partial<ActivityRow> = {}) => describeActivity({ ...rule(detail), ...over })
    expect(line({ action: 'move_stage', stage: 'Review', stage_from: 'Doing' })).toBe('Moved "Login" from Doing to Review by the rule “Tell QA”')
    expect(line({ action: 'set_priority', priority: 'urgent' })).toBe('Set the priority of "Login" to Urgent by the rule “Tell QA”')
    expect(line({ action: 'assign' }, { subject_name: 'Ben Cruz' })).toBe('Assigned "Login" to Ben Cruz by the rule “Tell QA”')
    expect(line({ action: 'assign' })).toBe('Assigned "Login" to somebody by the rule “Tell QA”')
    expect(line({ action: 'notify', notify_to: 'planners' })).toBe('Notified the project manager and coordinators about "Login" by the rule “Tell QA”')
  })

  it('folds the companion row into the rule line and keeps who was given the task', () => {
    const moved = row({ id: 'u1', kind: 'updated', detail: { fields: ['status'], status: 'in_progress' } })
    const given = row({ id: 'u2', kind: 'assigned', subject_name: 'Ben Cruz' })
    const lines = foldActivity([moved, rule({ action: 'move_stage', stage: 'Review' })]).map(describeActivity)
    expect(lines).toEqual(['Moved "Login" to Review by the rule “Tell QA”'])
    expect(foldActivity([given, rule({ action: 'assign' })]).map(describeActivity)).toEqual(['Assigned "Login" to Ben Cruz by the rule “Tell QA”'])
  })

  it('keeps every row beside a notify rule', () => {
    const moved = row({ id: 'u1', kind: 'updated', detail: { fields: ['status'], status: 'in_progress' } })
    const rows = foldActivity([moved, rule({ action: 'notify', notify_to: 'qa' })])
    expect(rows.map((r) => r.id)).toEqual(['u1', 'r1'])
  })

  it('offers rule changes among the task kinds a report can filter on', () => {
    expect(ACTIVITY_KINDS.find((k) => k.label === 'Tasks')?.kinds).toContain('rule_applied')
  })
})
