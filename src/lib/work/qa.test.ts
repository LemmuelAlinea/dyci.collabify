import { describe, expect, it } from 'vitest'
import { carryQaStage, inQa, qaBlocks, qaStageIndex } from './qa'

const SYSTEM = ['Planning', 'Development', 'Testing', 'Revision', 'Completed']

describe('qaStageIndex', () => {
  it('is the stage qa_stage names, matched ignoring case and spaces', () => {
    expect(qaStageIndex(SYSTEM, 'Revision')).toBe(3)
    expect(qaStageIndex(SYSTEM, '  development ')).toBe(1)
  })

  it('falls back to a stage named Testing', () => {
    expect(qaStageIndex(SYSTEM, null)).toBe(2)
    expect(qaStageIndex(['To do', 'Build', 'testing', 'Ship', 'Done'], null)).toBe(2)
  })

  it('falls back to the stage before the last', () => {
    expect(qaStageIndex(['Topic', 'Research', 'Drafting', 'Review', 'Final'], null)).toBe(3)
    expect(qaStageIndex(null, null)).toBe(1)
  })

  it('ignores a qa_stage that is not a middle stage', () => {
    expect(qaStageIndex(SYSTEM, 'Planning')).toBe(2)
    expect(qaStageIndex(SYSTEM, 'Completed')).toBe(2)
    expect(qaStageIndex(SYSTEM, 'Gone')).toBe(2)
  })

  it('reads the default three when the project has no list', () => {
    expect(qaStageIndex(null, 'In progress')).toBe(1)
  })
})

describe('inQa', () => {
  it('is a task sitting on the QA stage', () => {
    expect(inQa({ status: 'in_progress', stage: 2 }, SYSTEM, null)).toBe(true)
    expect(inQa({ status: 'in_progress', stage: 1 }, SYSTEM, null)).toBe(false)
    expect(inQa({ status: 'in_progress', stage: 3 }, SYSTEM, 'Revision')).toBe(true)
  })

  it('is never a to do or done task', () => {
    expect(inQa({ status: 'todo' }, SYSTEM, null)).toBe(false)
    expect(inQa({ status: 'done' }, SYSTEM, null)).toBe(false)
  })

  it('reads an in progress task with no stored stage as the first middle stage', () => {
    expect(inQa({ status: 'in_progress' }, null, null)).toBe(true)
    expect(inQa({ status: 'in_progress' }, SYSTEM, 'Development')).toBe(true)
  })
})

describe('carryQaStage', () => {
  it('keeps a selection that did not change', () => {
    expect(carryQaStage(SYSTEM, SYSTEM, 'Revision')).toBe('Revision')
    expect(carryQaStage(SYSTEM, SYSTEM, null)).toBeNull()
  })

  it('follows the stage when it is renamed', () => {
    const next = ['Planning', 'Development', 'Testing', 'Rework', 'Completed']
    expect(carryQaStage(SYSTEM, next, 'Revision')).toBe('Rework')
  })

  it('lets go of the stage when it is removed', () => {
    const next = ['Planning', 'Development', 'Testing', 'Completed']
    expect(carryQaStage(SYSTEM, next, 'Revision')).toBeNull()
  })

  it('keeps the stage when the list is reordered', () => {
    const next = ['Planning', 'Revision', 'Development', 'Testing', 'Completed']
    expect(carryQaStage(SYSTEM, next, 'Revision')).toBe('Revision')
  })

  it('lets go of the stage when it is moved to the first or last place', () => {
    expect(carryQaStage(SYSTEM, ['Revision', 'Development', 'Testing', 'Planning', 'Completed'], 'Revision')).toBeNull()
    expect(carryQaStage(SYSTEM, ['Planning', 'Development', 'Testing', 'Completed', 'Revision'], 'Revision')).toBeNull()
  })

  it('lets go of the stage when a preset replaces the whole list', () => {
    expect(carryQaStage(SYSTEM, ['To do', 'In progress', 'Done'], 'Revision')).toBeNull()
    expect(carryQaStage(SYSTEM, ['A', 'B', 'C', 'D', 'E'], 'Revision')).toBeNull()
  })

  it('works from the default three, which a project stores as no list', () => {
    expect(carryQaStage(null, ['To do', 'Review', 'Done'], 'In progress')).toBe('Review')
    expect(carryQaStage(null, null, 'In progress')).toBe('In progress')
  })
})

describe('qaBlocks', () => {
  const on = { hasQa: true, role: 'member' as const }
  // Planning 0, Development 1, Testing 2 (QA), Revision 3, Completed 4.
  const block = (gate: Parameters<typeof qaBlocks>[0], from: number, to: number) =>
    qaBlocks(gate, SYSTEM, null, from, to)

  it('refuses leaving the QA stage forward', () => {
    expect(block(on, 2, 3)).toBe(true)
    expect(block(on, 2, 4)).toBe(true)
  })

  it('refuses reaching the last stage from anywhere else', () => {
    expect(block(on, 0, 4)).toBe(true)
    expect(block(on, 1, 4)).toBe(true)
    expect(block(on, 3, 4)).toBe(true)
  })

  it('lets everything else through', () => {
    expect(block(on, 0, 1)).toBe(false)
    expect(block(on, 1, 2)).toBe(false) // into QA
    expect(block(on, 2, 1)).toBe(false) // back out of QA
    expect(block(on, 4, 0)).toBe(false) // reopen
    expect(block(on, 4, 4)).toBe(false)
  })

  it('does not apply without active QA', () => {
    expect(block({ hasQa: false, role: 'member' }, 2, 4)).toBe(false)
    expect(block({ hasQa: false, role: 'coordinator' }, 1, 4)).toBe(false)
  })

  it('never applies to QA or the project manager', () => {
    expect(block({ hasQa: true, role: 'qa' }, 2, 4)).toBe(false)
    expect(block({ hasQa: true, role: 'pm' }, 1, 4)).toBe(false)
  })

  it('applies to a coordinator', () => {
    expect(block({ hasQa: true, role: 'coordinator' }, 2, 3)).toBe(true)
  })

  it('reads the QA stage the project names, and the default three', () => {
    expect(qaBlocks(on, SYSTEM, 'Revision', 3, 4)).toBe(true)
    expect(qaBlocks(on, SYSTEM, 'Revision', 2, 3)).toBe(false)
    expect(qaBlocks(on, null, null, 1, 2)).toBe(true)
    expect(qaBlocks(on, null, null, 0, 1)).toBe(false)
  })
})
