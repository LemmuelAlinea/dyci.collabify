import { describe, expect, it } from 'vitest'
import {
  checkStagePlan,
  stageGoal,
  stageName,
  stageNote,
  stageTotals,
  type StageMilestone,
  type StageSlot,
  type StageTask,
} from '../../../supabase/functions/_shared/stagePlan.ts'

const slot = (i: number, over: Partial<StageSlot> = {}): StageSlot => ({
  key: `s${i + 1}`,
  id: null,
  starts_on: ['2026-12-01', '2026-12-15', '2026-12-29'][i],
  ends_on: ['2026-12-14', '2026-12-28', '2027-01-11'][i],
  capacity_minutes: i === 2 ? 600 : 2400,
  milestone_id: null,
  buffer: i === 2,
  ...over,
})
const slots = [slot(0), slot(1), slot(2)]

const task = (n: number, over: Partial<StageTask> = {}): StageTask => ({
  id: `id${n}`,
  key: `t${n}`,
  title: `Task ${n}`,
  minutes: 60,
  priority: 'normal',
  rank: n,
  due_on: null,
  milestone_id: null,
  depends_on: [],
  ...over,
})

const stageOf = (placement: ReturnType<typeof checkStagePlan>, id: string) => placement.find((p) => p.task_id === id)
const none: StageMilestone[] = []

describe('checkStagePlan', () => {
  it("keeps the AI's placement when it fits", () => {
    expect(stageOf(checkStagePlan(slots, [task(1)], none, { t1: 's2' }), 'id1')).toEqual({ task_id: 'id1', stage: 1, flag: null })
  })

  it('moves a task after the task it waits on', () => {
    const tasks = [task(1), task(2, { depends_on: ['id1'] })]
    const out = checkStagePlan(slots, tasks, none, { t1: 's2', t2: 's1' })
    expect(stageOf(out, 'id2')?.stage).toBe(1)
  })

  it('never fills the buffer from the AI', () => {
    expect(stageOf(checkStagePlan(slots, [task(1)], none, { t1: 's3' }), 'id1')?.stage).toBe(1)
  })

  it('pushes past a full stage', () => {
    const roomy = [slot(0), slot(1), slot(2, { capacity_minutes: 1600 })]
    const tasks = [1, 2, 3].map((n) => task(n, { minutes: 1500 }))
    const out = checkStagePlan(roomy, tasks, none, { t1: 's1', t2: 's1', t3: 's1' })
    expect(tasks.map((t) => stageOf(out, t.id)?.stage)).toEqual([0, 1, 2])
  })

  it("a task waiting on a task that won't fit stays out too", () => {
    const tasks = [task(1, { minutes: 9000 }), task(2, { depends_on: ['id1'] })]
    const out = checkStagePlan(slots, tasks, none, { t1: 's1', t2: 's2' })
    expect(stageOf(out, 'id1')).toEqual({ task_id: 'id1', stage: null, flag: 'wont_fit' })
    expect(stageOf(out, 'id2')).toEqual({ task_id: 'id2', stage: null, flag: 'wont_fit' })
  })

  it('a milestone task lands by the milestone', () => {
    const ms: StageMilestone[] = [{ id: 'm', key: 'm1', name: 'Beta', due_on: '2026-12-14' }]
    expect(stageOf(checkStagePlan(slots, [task(1, { milestone_id: 'm' })], ms, { t1: 's2' }), 'id1')?.stage).toBe(0)
  })

  it('a stage linked to a milestone binds the tasks wanted in it', () => {
    const ms: StageMilestone[] = [{ id: 'm', key: 'm1', name: 'Beta', due_on: '2026-12-28' }]
    const linked = [slot(0, { capacity_minutes: 60 }), slot(1, { milestone_id: 'm', capacity_minutes: 60 }), slot(2)]
    const out = checkStagePlan(linked, [task(1), task(2)], ms, { t1: 's2', t2: 's2' })
    expect(stageOf(out, 'id2')).toEqual({ task_id: 'id2', stage: 1, flag: 'over_hours' })
  })

  it('a full milestone stage keeps the task and flags it', () => {
    const ms: StageMilestone[] = [{ id: 'm', key: 'm1', name: 'Beta', due_on: '2026-12-14' }]
    const tasks = [task(1, { minutes: 2400 }), task(2, { milestone_id: 'm' })]
    const out = checkStagePlan(slots, tasks, ms, { t1: 's1', t2: 's1' })
    expect(stageOf(out, 'id2')).toEqual({ task_id: 'id2', stage: 0, flag: 'over_hours' })
  })

  it('a due date keeps a task in a stage that starts by it', () => {
    expect(stageOf(checkStagePlan(slots, [task(1, { due_on: '2026-12-10' })], none, { t1: 's2' }), 'id1')?.stage).toBe(0)
  })

  it('an overdue task goes first', () => {
    expect(stageOf(checkStagePlan(slots, [task(1, { due_on: '2026-11-20' })], none, { t1: 's2' }), 'id1'))
      .toEqual({ task_id: 'id1', stage: 0, flag: 'overdue' })
  })

  it("flags a task that can't meet its date after the task it waits on", () => {
    const tasks = [task(1), task(2, { depends_on: ['id1'], due_on: '2026-12-10' })]
    const out = checkStagePlan(slots, tasks, none, { t1: 's2', t2: 's1' })
    expect(stageOf(out, 'id2')).toEqual({ task_id: 'id2', stage: 1, flag: 'late' })
  })

  it('a dependency loop still places every task once', () => {
    const tasks = [task(1, { depends_on: ['id2'] }), task(2, { depends_on: ['id1'] })]
    const out = checkStagePlan(slots, tasks, none, { t1: 's1', t2: 's1' })
    expect(out).toHaveLength(2)
    expect(out.every((p) => p.stage !== null)).toBe(true)
  })

  it('unknown keys go to the earliest stage that fits', () => {
    expect(stageOf(checkStagePlan(slots, [task(1)], none, { t1: 's9' }), 'id1')?.stage).toBe(0)
    expect(stageOf(checkStagePlan(slots, [task(1)], none, {}), 'id1')?.stage).toBe(0)
  })

  it('higher priority gets the room first', () => {
    const tasks = [task(1, { minutes: 2000 }), task(2, { minutes: 2000, priority: 'urgent' })]
    const out = checkStagePlan(slots, tasks, none, { t1: 's1', t2: 's1' })
    expect(stageOf(out, 'id2')?.stage).toBe(0)
    expect(stageOf(out, 'id1')?.stage).toBe(1)
  })

  it('an unestimated task takes no room', () => {
    const tasks = [task(1, { minutes: 2400 }), task(2, { minutes: null })]
    expect(stageOf(checkStagePlan(slots, tasks, none, { t1: 's1', t2: 's1' }), 'id2')?.stage).toBe(0)
  })
})

describe('stageTotals', () => {
  it('counts unestimated apart and marks over', () => {
    const tasks = [task(1, { minutes: 2500 }), task(2, { minutes: null }), task(3, { minutes: 30 })]
    const totals = stageTotals(slots, tasks, [
      { task_id: 'id1', stage: 0, flag: null },
      { task_id: 'id2', stage: 0, flag: null },
      { task_id: 'id3', stage: 1, flag: null },
    ])
    expect(totals).toEqual([
      { minutes: 2500, unestimated: 1, over: true },
      { minutes: 30, unestimated: 0, over: false },
      { minutes: 0, unestimated: 0, over: false },
    ])
  })
})

describe('stage text', () => {
  it('stageName falls back and caps', () => {
    expect(stageName('', 2, 'Phase')).toBe('Phase 3')
    expect(stageName('x'.repeat(70), 0, 'Phase')).toHaveLength(60)
    expect(stageName('Do t3 first', 0, 'Phase')).not.toMatch(/\bt3\b/)
  })

  it('stageGoal trims, caps and hides ids', () => {
    expect(stageGoal(`  ${'y'.repeat(250)}  `)).toHaveLength(200)
    expect(stageGoal('Finish s2 and m1 work')).not.toMatch(/\b(s2|m1)\b/)
    expect(stageGoal(null)).toBe('')
  })

  it('stageNote hides ids and is null when empty', () => {
    expect(stageNote('t4 needs c2 before s3')).toBe('a task needs someone before a stage')
    expect(stageNote('  ')).toBeNull()
  })
})
