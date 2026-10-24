import { describe, expect, it } from 'vitest'
import { carryQaStage, inQa, qaBlocks, qaStageIndex, holdsQa, qaTile, queueOrder, waitedFor } from './qa'

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

  const qa = { hasQa: true, role: 'qa' as const }

  it('refuses a holder passing a task out of Testing', () => {
    expect(block(on, 2, 3)).toBe(true) // Testing to Revision
    expect(block(on, 2, 4)).toBe(true)
  })

  it('refuses a holder skipping Testing', () => {
    expect(block(on, 1, 3)).toBe(true) // Development to Revision
    expect(block(on, 0, 4)).toBe(true)
    expect(block(on, 1, 4)).toBe(true)
  })

  it('lets a holder move among the stages after Testing, and back', () => {
    expect(block(on, 3, 4)).toBe(false) // Revision to Completed
    expect(block(on, 4, 3)).toBe(false)
    expect(block(on, 3, 2)).toBe(false)
    expect(block(on, 4, 0)).toBe(false) // reopen
    expect(block(on, 4, 4)).toBe(false)
  })

  it('lets everything up to Testing through', () => {
    expect(block(on, 0, 1)).toBe(false)
    expect(block(on, 1, 2)).toBe(false) // into QA
    expect(block(on, 2, 1)).toBe(false) // back out of QA
  })

  it('lets QA cross from Testing only', () => {
    expect(block(qa, 2, 3)).toBe(false) // Testing to Revision
    expect(block(qa, 2, 4)).toBe(false)
    expect(block(qa, 1, 4)).toBe(true) // a QA team lead, Development to Completed
    expect(block(qa, 1, 3)).toBe(true)
    expect(block(qa, 1, 2)).toBe(false)
  })

  it('never applies to the project manager', () => {
    expect(block({ hasQa: true, role: 'pm' }, 1, 4)).toBe(false)
    expect(block({ hasQa: true, role: 'pm' }, 0, 3)).toBe(false)
  })

  it('does not apply without active QA', () => {
    expect(block({ hasQa: false, role: 'member' }, 2, 4)).toBe(false)
    expect(block({ hasQa: false, role: 'coordinator' }, 1, 4)).toBe(false)
  })

  it('applies to a coordinator', () => {
    expect(block({ hasQa: true, role: 'coordinator' }, 2, 3)).toBe(true)
  })

  it('reads the QA stage the project names, and the default three', () => {
    expect(qaBlocks(on, SYSTEM, 'Revision', 3, 4)).toBe(true)
    expect(qaBlocks(on, SYSTEM, 'Revision', 2, 3)).toBe(false)
    expect(qaBlocks(on, SYSTEM, 'Revision', 2, 4)).toBe(true)
    expect(qaBlocks(on, null, null, 1, 2)).toBe(true) // In progress to Done
    expect(qaBlocks(on, null, null, 0, 2)).toBe(true) // To do to Done
    expect(qaBlocks(on, null, null, 0, 1)).toBe(false)
  })

  it('keeps a status-only done from before QA refused on four stages', () => {
    const four = ['Planning', 'Development', 'Testing', 'Done']
    expect(qaBlocks(on, four, null, 1, 3)).toBe(true)
    expect(qaBlocks(on, four, null, 2, 3)).toBe(true)
    expect(qaBlocks(qa, four, null, 2, 3)).toBe(false)
  })
})

describe('queueOrder', () => {
  const t = (id: string, at: string | null) => ({ id, qa_entered_at: at })

  it('puts the longest-waiting task first', () => {
    const out = queueOrder([t('b', '2026-10-02T00:00:00Z'), t('a', '2026-10-01T00:00:00Z'), t('c', '2026-10-03T00:00:00Z')])
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('puts tasks with no entry time last, in the order given', () => {
    const out = queueOrder([t('n1', null), t('b', '2026-10-02T00:00:00Z'), t('n2', null), t('a', '2026-10-01T00:00:00Z')])
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'n1', 'n2'])
  })

  it('treats a missing field like null and leaves the input alone', () => {
    const input: { id: string; qa_entered_at?: string | null }[] = [{ id: 'x' }, t('a', '2026-10-01T00:00:00Z')]
    expect(queueOrder(input).map((x) => x.id)).toEqual(['a', 'x'])
    expect(input.map((x) => x.id)).toEqual(['x', 'a'])
  })
})

describe('waitedFor', () => {
  const now = new Date('2026-10-10T12:00:00Z').getTime()

  it('says how long a task has been in QA', () => {
    expect(waitedFor('2026-10-10T11:50:00Z', now)).toBe('Waiting under an hour')
    expect(waitedFor('2026-10-10T09:00:00Z', now)).toBe('Waiting 3 hours')
    expect(waitedFor('2026-10-10T11:00:00Z', now)).toBe('Waiting 1 hour')
    expect(waitedFor('2026-10-07T12:00:00Z', now)).toBe('Waiting 3 days')
    expect(waitedFor('2026-10-09T10:00:00Z', now)).toBe('Waiting 1 day')
  })

  it('does not guess when the time is unknown', () => {
    expect(waitedFor(null, now)).toBe('Waiting since before the queue kept time')
    expect(waitedFor(undefined, now)).toBe('Waiting since before the queue kept time')
  })

  it('never goes negative when the clocks disagree', () => {
    expect(waitedFor('2026-10-10T12:05:00Z', now)).toBe('Waiting under an hour')
  })
})

describe('qaTile', () => {
  const row = (project_id: string, waiting: number) => ({
    project_id,
    name: project_id,
    qa_stage_name: 'Testing',
    waiting,
    oldest_entered_at: null,
  })

  it('adds up what waits and picks the project with the most', () => {
    const { total, busiest } = qaTile([row('a', 2), row('b', 5), row('c', 1)])
    expect(total).toBe(8)
    expect(busiest?.project_id).toBe('b')
  })

  it('takes the first of a tie', () => {
    expect(qaTile([row('a', 3), row('b', 3)]).busiest?.project_id).toBe('a')
  })

  it('has no busiest project when nothing waits', () => {
    expect(qaTile([row('a', 0)])).toEqual({ total: 0, busiest: null })
    expect(qaTile([])).toEqual({ total: 0, busiest: null })
  })
})

describe('holdsQa', () => {
  const p = (my_role: 'qa' | 'member' | 'pm' | null, archived_at: string | null = null) => ({ my_role, archived_at })

  it('is true for QA on a live project', () => {
    expect(holdsQa([p('member'), p('qa')])).toBe(true)
  })

  it('is false for other roles, an archived project, or nothing loaded', () => {
    expect(holdsQa([p('member'), p('pm'), p(null)])).toBe(false)
    expect(holdsQa([p('qa', '2026-10-01T00:00:00Z')])).toBe(false)
    expect(holdsQa([])).toBe(false)
    expect(holdsQa(null)).toBe(false)
  })
})
