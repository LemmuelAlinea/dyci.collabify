import { describe, expect, it } from 'vitest'
import { edgeSpeed, landingIndex, workDropRefusal } from './boardDrop'
import { QA_PASSES } from './qa'

const stages = 5 // Planning, Development, Testing, Revision, Completed

const input = (over: Partial<Parameters<typeof workDropRefusal>[0]> = {}) => ({
  task: { status: 'in_progress' as const, stage: 1, assignee_ids: ['me'], parent_id: null },
  to: 2,
  stageCount: stages,
  qaBlocks: () => false,
  rules: { requireAssignee: false, requireSubtasksDone: true },
  openSubtasks: 0,
  blockers: [],
  parentDone: false,
  ...over,
})

describe('workDropRefusal', () => {
  it('allows a plain move to another stage', () => {
    expect(workDropRefusal(input())).toBeNull()
  })

  it('refuses a move the QA gate holds back', () => {
    const qaBlocks = (from: number, to: number) => from === 1 && to === 3
    expect(workDropRefusal(input({ to: 3, qaBlocks }))).toBe(QA_PASSES)
    expect(workDropRefusal(input({ to: 2, qaBlocks }))).toBeNull()
  })

  it('names the first task a Done move is waiting for', () => {
    const blockers = [{ title: 'Write the schema' }, { title: 'Set up hosting' }]
    expect(workDropRefusal(input({ to: 4, blockers }))).toBe('Waiting for Write the schema. Finish it first.')
  })

  it('lets a blocked task move to any stage before Done', () => {
    expect(workDropRefusal(input({ to: 3, blockers: [{ title: 'Write the schema' }] }))).toBeNull()
  })

  it('refuses Done while a subtask is open when the project requires it', () => {
    expect(workDropRefusal(input({ to: 4, openSubtasks: 2 }))).toBe('Finish its subtasks first.')
  })

  it('allows Done with open subtasks when the project does not require them done', () => {
    const rules = { requireAssignee: false, requireSubtasksDone: false }
    expect(workDropRefusal(input({ to: 4, openSubtasks: 2, rules }))).toBeNull()
  })

  it('refuses moving an unheld task forward when the project requires a holder', () => {
    const rules = { requireAssignee: true, requireSubtasksDone: true }
    const task = { status: 'todo' as const, stage: 0, assignee_ids: [], parent_id: null }
    expect(workDropRefusal(input({ task, to: 1, rules }))).toBe('Give this task a holder before moving it on.')
  })

  it('lets an unheld task move back when the project requires a holder', () => {
    const rules = { requireAssignee: true, requireSubtasksDone: true }
    const task = { status: 'in_progress' as const, stage: 2, assignee_ids: [], parent_id: null }
    expect(workDropRefusal(input({ task, to: 1, rules }))).toBeNull()
  })

  it('refuses reopening a finished subtask while its parent is done', () => {
    const task = { status: 'done' as const, stage: 4, assignee_ids: ['me'], parent_id: 'p' }
    expect(workDropRefusal(input({ task, to: 1, parentDone: true }))).toBe(
      'Reopen the parent task before opening its subtask.',
    )
  })

  it('applies none of the work rules on a class board', () => {
    const task = { status: 'in_progress' as const, stage: 1, assignee_ids: [], parent_id: null }
    expect(
      workDropRefusal(input({ task, to: 4, rules: null, openSubtasks: 3, blockers: [{ title: 'A' }] })),
    ).toBeNull()
  })

  it('names the QA gate before the other rules, as the database does', () => {
    expect(workDropRefusal(input({ to: 4, qaBlocks: () => true, openSubtasks: 1 }))).toBe(QA_PASSES)
  })
})

describe('landingIndex', () => {
  it('finds where a card lands among the target column, by board order', () => {
    expect(landingIndex(['a', 'b', 'c', 'd'], ['a', 'd'], 'c')).toBe(1)
  })

  it('lands first when nothing in the column comes before it', () => {
    expect(landingIndex(['c', 'a'], ['a'], 'c')).toBe(0)
  })

  it('lands last in an empty column', () => {
    expect(landingIndex(['c'], [], 'c')).toBe(0)
  })
})

describe('edgeSpeed', () => {
  it('stays still away from the edges', () => {
    expect(edgeSpeed(400, 0, 800)).toBe(0)
  })

  it('scrolls back near the start and forward near the end', () => {
    expect(edgeSpeed(10, 0, 800)).toBeLessThan(0)
    expect(edgeSpeed(790, 0, 800)).toBeGreaterThan(0)
  })

  it('speeds up closer to the edge', () => {
    expect(edgeSpeed(795, 0, 800)).toBeGreaterThan(edgeSpeed(750, 0, 800))
  })

  it('holds the top speed when the pointer leaves the area', () => {
    expect(edgeSpeed(900, 0, 800)).toBe(edgeSpeed(800, 0, 800))
  })
})
