import { pickTeamRoutes, pickLeadAssignees, maskMemberNames } from '../../../supabase/functions/_shared/assignPick'
import { describe, expect, it } from 'vitest'
import { isAssignCandidate, notesWhy, planAssignSave, reasonText, rowsFromPicks, skippedMessage } from './assignDraft'
import type { AssignRow } from './assignDraft'
import type { GeneralMember, GeneralTask } from '../general/types'

const task = (over: Partial<GeneralTask>): GeneralTask =>
  ({ id: 't', title: 'Task', status: 'todo', assignee_ids: [], archived_at: null, ...over }) as GeneralTask

const row = (over: Partial<AssignRow>): AssignRow => ({
  taskId: 't',
  keep: true,
  title: 'Task',
  originalTitle: 'Task',
  people: ['u1'],
  kind: 'position',
  label: 'Frontend developer',
  reason: '',
  ...over,
})

const member = (over: Partial<GeneralMember>): GeneralMember =>
  ({
    project_id: 'p',
    user_id: 'u',
    level: 'member',
    role: 'member',
    joined_at: '2026-10-01T00:00:00Z',
    profile: { status: 'active' },
    ...over,
  }) as GeneralMember

describe('rowsFromPicks', () => {
  it('keeps every pick, with its holder when it has one', () => {
    expect(
      rowsFromPicks([
        { key: 'a', title: 'Login page', userId: 'u1', kind: 'position', label: 'Frontend developer', reason: 'UI work' },
        { key: 'b', title: 'Odd job', userId: null, kind: 'none', label: '', reason: '' },
      ]),
    ).toEqual([
      { taskId: 'a', keep: true, title: 'Login page', originalTitle: 'Login page', people: ['u1'], kind: 'position', label: 'Frontend developer', reason: 'UI work' },
      { taskId: 'b', keep: true, title: 'Odd job', originalTitle: 'Odd job', people: [], kind: 'none', label: '', reason: '' },
    ])
  })
})

describe('reasonText', () => {
  it('reads a position, a tag and none', () => {
    expect(reasonText({ kind: 'position', label: 'Frontend developer', reason: 'Screen design is frontend work' })).toBe(
      'Frontend developer · Screen design is frontend work',
    )
    expect(reasonText({ kind: 'tag', label: 'Figma', reason: 'Uses the Figma file' })).toBe('tag: Figma · Uses the Figma file')
    expect(reasonText({ kind: 'none', label: '', reason: 'Nothing matched' })).toBe('No position fits')
  })

  it('drops the reason part when the reason is empty', () => {
    expect(reasonText({ kind: 'position', label: 'Frontend developer', reason: '' })).toBe('Frontend developer')
    expect(reasonText({ kind: 'tag', label: 'Figma', reason: '  ' })).toBe('tag: Figma')
  })
})

describe('planAssignSave', () => {
  it('skips rows whose task was taken or archived meanwhile', () => {
    const plan = planAssignSave(
      [row({ taskId: 'a' }), row({ taskId: 'b' }), row({ taskId: 'c' })],
      [task({ id: 'a', assignee_ids: ['u9'] }), task({ id: 'b', archived_at: '2026-10-25T00:00:00Z' }), task({ id: 'c' })],
    )
    expect(plan).toEqual({ apply: [{ taskId: 'c', title: null, people: ['u1'] }], skipped: 2 })
  })

  it('skips rows whose task is gone or done', () => {
    const plan = planAssignSave([row({ taskId: 'gone' }), row({ taskId: 'd' })], [task({ id: 'd', status: 'done' })])
    expect(plan).toEqual({ apply: [], skipped: 2 })
  })

  it('ignores rows that are not kept', () => {
    expect(planAssignSave([row({ taskId: 'a', keep: false })], [task({ id: 'a', assignee_ids: ['u9'] })])).toEqual({
      apply: [],
      skipped: 0,
    })
  })

  it('sends a changed title trimmed, and null when unchanged or empty', () => {
    const plan = planAssignSave(
      [
        row({ taskId: 'a', title: '  New ' }),
        row({ taskId: 'b' }),
        row({ taskId: 'c', title: '   ' }),
      ],
      [task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })],
    )
    expect(plan.apply).toEqual([
      { taskId: 'a', title: 'New', people: ['u1'] },
      { taskId: 'b', title: null, people: ['u1'] },
      { taskId: 'c', title: null, people: ['u1'] },
    ])
  })

  it('leaves out a kept row with no people and no title change', () => {
    expect(planAssignSave([row({ taskId: 'a', people: [] })], [task({ id: 'a' })])).toEqual({ apply: [], skipped: 0 })
  })

  it('applies a title change with nobody on it', () => {
    expect(planAssignSave([row({ taskId: 'a', people: [], title: 'Renamed' })], [task({ id: 'a' })])).toEqual({
      apply: [{ taskId: 'a', title: 'Renamed', people: [] }],
      skipped: 0,
    })
  })
})

describe('isAssignCandidate', () => {
  it('offers the pm, coordinators and members who are active', () => {
    expect(isAssignCandidate(member({ role: 'pm' }))).toBe(true)
    expect(isAssignCandidate(member({ role: 'coordinator' }))).toBe(true)
    expect(isAssignCandidate(member({ role: 'member' }))).toBe(true)
  })

  it('never offers QA or stakeholders', () => {
    expect(isAssignCandidate(member({ role: 'qa' }))).toBe(false)
    expect(isAssignCandidate(member({ role: 'stakeholder' }))).toBe(false)
  })

  it('never offers someone deactivated', () => {
    expect(isAssignCandidate(member({ profile: { status: 'deactivated' } as unknown as GeneralMember['profile'] }))).toBe(false)
  })

  it('counts an unreadable profile as live', () => {
    expect(isAssignCandidate(member({ profile: null }))).toBe(true)
  })
})

describe('skippedMessage', () => {
  it('says how many tasks changed meanwhile', () => {
    expect(skippedMessage(0)).toBe('')
    expect(skippedMessage(1)).toBe('1 task changed while you were reviewing and was left as it is.')
    expect(skippedMessage(3)).toBe('3 tasks changed while you were reviewing and were left as they are.')
  })
})

describe('notesWhy', () => {
  const pick = { kind: 'position' as const, label: 'Designer', reason: 'Screen work' }
  it('keeps a named eligible person', () => {
    expect(notesWhy({ name: 'Ana', blocked: null }, pick)).toBe('Named in the notes')
  })
  it('explains each blocked name and a replacement', () => {
    expect(notesWhy({ name: 'Ana', blocked: 'qa' }, pick)).toBe("Named Ana (QA can't hold tasks), suggested by position · Designer · Screen work")
    expect(notesWhy({ name: 'Ana', blocked: 'stakeholder' }, { kind: 'tag', label: 'Figma', reason: 'UI work' })).toBe("Named Ana (stakeholders can't hold tasks), suggested by position · tag: Figma · UI work")
    expect(notesWhy({ name: 'Ana', blocked: 'inactive' }, pick)).toBe('Named Ana (not active on the project), suggested by position · Designer · Screen work')
  })
  it('explains a blocked name without a replacement', () => {
    expect(notesWhy({ name: 'Ana', blocked: 'qa' }, { kind: 'none', label: '', reason: '' })).toBe("Named Ana (QA can't hold tasks) · No position fits")
    expect(notesWhy({ name: 'Ana', blocked: 'qa' }, null)).toBe("Named Ana (QA can't hold tasks) · No position fits")
  })
  it('explains an unnamed task from its pick', () => {
    expect(notesWhy(null, pick)).toBe('Designer · Screen work')
    expect(notesWhy(null, null)).toBe('')
  })
})


describe('scoped position picks', () => {
  const tasks = [{ key: 'a', title: 'UI', description: '', teamId: 'b' }, { key: 'b', title: 'UI', description: '', teamId: 'b' }]
  const matches = tasks.map(t => ({ key: t.key, kind: 'position' as const, match: 'p', reason: 'UI' }))
  const candidates = [
    { userId: 'a', name: 'Ana', load: 0, teams: ['a'], positions: ['p'], tags: ['UI'] },
    { userId: 'b', name: 'Ben', load: 1, teams: ['b'], positions: ['p'], tags: ['UI'] },
    { userId: 'c', name: 'Cam', load: 1, teams: ['b'], positions: ['p'], tags: ['UI'] },
  ]
  const teams = [{ id: 'a', name: 'Alpha', load: 0 }, { id: 'b', name: 'Beta', load: 4 }]
  it('routes to the position team before candidate counts', () => {
    expect(pickTeamRoutes(tasks, matches, candidates, [{ id: 'p', name: 'UI', team_id: 'a' }], teams)[0].teamId).toBe('a')
  })
  it('ranks matching member count, released load, name, then id', () => {
    const positions = [{ id: 'p', name: 'UI' }]
    expect(pickTeamRoutes(tasks, matches, candidates, positions, teams)[0].teamId).toBe('b')
    expect(pickTeamRoutes(tasks, matches, candidates.slice(0, 2), positions, teams)[0].teamId).toBe('a')
    expect(pickTeamRoutes(tasks, matches, candidates.slice(0, 2), positions, teams.map(t => ({ ...t, load: 0 })))[0].teamId).toBe('a')
  })
  it('leaves an unknown match blank', () => {
    expect(pickTeamRoutes(tasks, [], candidates, [], teams)[0].teamId).toBeNull()
  })
  it('balances only within the receiving team and never falls back outside it', () => {
    expect(pickLeadAssignees(tasks, matches, candidates, [{ id: 'p', name: 'UI' }]).map(p => p.userId)).toEqual(['b', 'c'])
    expect(pickLeadAssignees(tasks, matches, candidates.slice(0, 1), [{ id: 'p', name: 'UI' }])[0].userId).toBeNull()
  })
})


it('keeps member names and emails out of work AI text', () => {
  expect(maskMemberNames('Ana Smith and Ana: ana@example.test; Ben Jones.', ['Ana Smith', 'Ben Jones'])).toBe('person1 and person1: [email]; person2.')
})


it('masks standalone one-character member names without changing longer words', () => {
  expect(maskMemberNames('李 will review; 王 will test; 李 王 approves. 王国 stays.', ['李 王'])).toBe('person1 will review; person1 will test; person1 approves. 王国 stays.')
  expect(maskMemberNames('J reviews Java.', ['J'])).toBe('person1 reviews Java.')
})
