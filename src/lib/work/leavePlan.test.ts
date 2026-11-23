import { describe, expect, it } from 'vitest'
import { leaveCandidates, validateLeaveSuggestions } from '../../../supabase/functions/_shared/leavePlan.ts'

const ctx = {
  tasks: [{ key: 't1', taskId: 'task-a' }, { key: 't2', taskId: 'task-b' }, { key: 't3', taskId: 'task-c' }],
  people: [{ key: 'c1', userId: 'keneth' }, { key: 'c2', userId: 'ivan' }],
  leaveLast: '2026-12-10',
  today: '2026-11-23',
}

describe('validateLeaveSuggestions', () => {
  it('keeps valid suggestions', () => {
    expect(validateLeaveSuggestions({ suggestions: [
      { task: 't1', action: 'cover', person: 'c1', due_on: '', reason: 'Keneth knows Auth and has 9 h free.' },
      { task: 't2', action: 'move_due', person: '', due_on: '2026-12-14', reason: 'Nothing waits for it.' },
      { task: 't3', action: 'keep', person: 'c2', due_on: '2026-12-20', reason: 'It is due after the leave.' },
    ] }, ctx)).toEqual([
      { task_id: 'task-a', action: 'cover', person_id: 'keneth', due_on: null, reason: 'Keneth knows Auth and has 9 h free.' },
      { task_id: 'task-b', action: 'move_due', person_id: null, due_on: '2026-12-14', reason: 'Nothing waits for it.' },
      { task_id: 'task-c', action: 'keep', person_id: null, due_on: null, reason: 'It is due after the leave.' },
    ])
  })

  it('drops invented people and dates', () => {
    const out = validateLeaveSuggestions({ suggestions: [
      { task: 't1', action: 'reassign', person: 'c9', reason: 'x' },
      { task: 't1', action: 'cover', person: 'c2', reason: 'second for t1' },
      { task: 't2', action: 'move_due', due_on: '2026-12-09', reason: 'inside the leave' },
      { task: 't3', action: 'move_due', due_on: '2027-03-30', reason: 'too far out' },
      { task: 't9', action: 'keep', reason: 'unknown task' },
      { task: 't2', action: 'fly', reason: 'unknown action' },
    ] }, ctx)
    // The first t1 row is invalid, so t1 takes the next valid one.
    expect(out).toEqual([{ task_id: 'task-a', action: 'cover', person_id: 'ivan', due_on: null, reason: 'second for t1' }])
  })

  it('trims reasons', () => {
    const [s] = validateLeaveSuggestions({ suggestions: [{ task: 't1', action: 'keep', reason: `  ${'a'.repeat(300)}  ` }] }, ctx)
    expect(s.reason).toHaveLength(200)
  })

  it('reads nothing from a broken answer', () => {
    expect(validateLeaveSuggestions(null, ctx)).toEqual([])
    expect(validateLeaveSuggestions({ suggestions: 'no' }, ctx)).toEqual([])
  })
})

describe('leaveCandidates', () => {
  it('away people not sent', () => {
    expect(leaveCandidates([
      { user_id: 'a', skills: ['auth'], free_minutes: 540, away: false },
      { user_id: 'b', skills: [], free_minutes: 600, away: true },
      { user_id: 'c', skills: ['ui'], free_minutes: null, away: false },
    ])).toEqual([
      { key: 'c1', userId: 'a', skills: ['auth'], freeMinutes: 540 },
      { key: 'c2', userId: 'c', skills: ['ui'], freeMinutes: null },
    ])
  })
})
