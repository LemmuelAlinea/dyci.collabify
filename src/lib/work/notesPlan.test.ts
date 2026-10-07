import { describe, expect, it } from 'vitest'
import type { DraftedWorkTask } from '../api/workAi'
import { addedMessage, byMilestone, commitPlan, planProblem, resolveKey, shapePlan, sprintMilestone } from './notesPlan'
import type { Milestone, Sprint } from './types'

const task = (title: string, extra: Partial<DraftedWorkTask> = {}): DraftedWorkTask => ({
  title,
  description: '',
  assignee: '',
  team: '',
  due: '',
  start: '',
  sprint: '',
  milestone: '',
  files: [],
  ...extra,
})

const sprint = (id: string, name: string, state: Sprint['state'] = 'planned'): Sprint => ({
  id,
  name,
  goal: '',
  starts_on: '2026-10-01',
  ends_on: '2026-10-14',
  state,
  started_at: null,
  completed_at: null,
  created_at: '2026-10-01T00:00:00Z',
  milestone_id: null,
})

const milestone = (id: string, name: string): Milestone => ({
  id,
  name,
  description: '',
  due_on: '2026-11-01',
  reached_at: null,
  created_at: '2026-10-01T00:00:00Z',
})

const all = { sprints: true, createMilestones: true, tag: true }
const none = { sprints: [], milestones: [] }

describe('shapePlan', () => {
  it('leaves a plain task list in the backlog', () => {
    const plan = shapePlan({ tasks: [task('A'), task('B')] }, none, all)
    expect(plan.sprints).toEqual([])
    expect(plan.links).toEqual([
      { sprint: '', milestone: '' },
      { sprint: '', milestone: '' },
    ])
  })

  it('drafts each sprint and points its tasks at it, any case', () => {
    const plan = shapePlan(
      {
        tasks: [task('A', { sprint: 'Sprint 1' }), task('B', { sprint: 'sprint 2' }), task('C')],
        sprints: [
          { name: 'Sprint 1', goal: 'Plan', starts_on: '2026-10-12', ends_on: '2026-10-23' },
          { name: 'Sprint 2', goal: '', starts_on: '2026-10-26', ends_on: '2026-11-06' },
        ],
      },
      none,
      all,
    )
    expect(plan.sprints.map((s) => [s.key, s.name, s.startsOn, s.endsOn])).toEqual([
      ['new:0', 'Sprint 1', '2026-10-12', '2026-10-23'],
      ['new:1', 'Sprint 2', '2026-10-26', '2026-11-06'],
    ])
    expect(plan.links.map((l) => l.sprint)).toEqual(['new:0', 'new:1', ''])
  })

  it('dates an undated sprint from its tasks', () => {
    const plan = shapePlan(
      {
        tasks: [
          task('A', { sprint: 'S', start: '2026-10-14', due: '2026-10-16' }),
          task('B', { sprint: 'S', due: '2026-10-21' }),
          task('C', { sprint: 'S', start: '2026-10-12' }),
        ],
        sprints: [{ name: 'S', goal: '', starts_on: '', ends_on: '' }],
      },
      none,
      all,
    )
    expect(plan.sprints[0]).toMatchObject({ startsOn: '2026-10-12', endsOn: '2026-10-21' })
  })

  it('reuses an open sprint of the same name but not a finished one', () => {
    const plan = shapePlan(
      {
        tasks: [task('A', { sprint: 'Sprint 1' }), task('B', { sprint: 'Sprint 2' })],
        sprints: [
          { name: 'Sprint 1', goal: '', starts_on: '2026-10-12', ends_on: '2026-10-23' },
          { name: 'Sprint 2', goal: '', starts_on: '2026-10-26', ends_on: '2026-11-06' },
        ],
      },
      { sprints: [sprint('s1', 'sprint 1'), sprint('s2', 'Sprint 2', 'completed')], milestones: [] },
      all,
    )
    expect(plan.reused).toBe(1)
    expect(plan.sprints.map((s) => s.name)).toEqual(['Sprint 2'])
    expect(plan.links.map((l) => l.sprint)).toEqual(['s1', 'new:0'])
  })

  it('drops sprints for someone who may not plan', () => {
    const plan = shapePlan(
      { tasks: [task('A', { sprint: 'S' })], sprints: [{ name: 'S', goal: '', starts_on: '', ends_on: '' }] },
      none,
      { ...all, sprints: false },
    )
    expect(plan.sprints).toEqual([])
    expect(plan.links[0].sprint).toBe('')
  })

  it('tags an existing milestone and skips new ones when they may not be made', () => {
    const plan = shapePlan(
      {
        tasks: [task('A', { milestone: 'Prototype' }), task('B', { milestone: 'Defense' })],
        milestones: [
          { name: 'Prototype', description: '', due: '2026-11-06' },
          { name: 'Defense', description: '', due: '2026-12-04' },
        ],
      },
      { sprints: [], milestones: [milestone('m1', 'prototype')] },
      { ...all, createMilestones: false },
    )
    expect(plan.milestones).toEqual([])
    expect(plan.skippedMilestones).toBe(1)
    expect(plan.links.map((l) => l.milestone)).toEqual(['m1', ''])
  })

  it('drafts new milestones when allowed', () => {
    const plan = shapePlan(
      { tasks: [task('A', { milestone: 'Defense' })], milestones: [{ name: 'Defense', description: 'Final', due: '2026-12-04' }] },
      none,
      all,
    )
    expect(plan.milestones).toEqual([
      { key: 'newm:0', name: 'Defense', description: 'Final', dueOn: '2026-12-04', keep: true, sprints: [] },
    ])
    expect(plan.links[0].milestone).toBe('newm:0')
  })
})

describe('milestone sprints', () => {
  it('links the sprints the draft names to a milestone, each sprint once', () => {
    const plan = shapePlan(
      {
        tasks: [task('A', { sprint: 'Sprint 1' }), task('B', { sprint: 'Sprint 2' })],
        sprints: [
          { name: 'Sprint 1', goal: '', starts_on: '2026-10-12', ends_on: '2026-10-23' },
          { name: 'Sprint 2', goal: '', starts_on: '2026-10-26', ends_on: '2026-11-06' },
        ],
        milestones: [
          { name: 'Prototype', description: '', due: '2026-11-06', sprints: ['sprint 1', 'Sprint 2', 'Sprint 9'] },
          { name: 'Again', description: '', due: '2026-11-07', sprints: ['Sprint 1'] },
        ],
      },
      { sprints: [sprint('s0', 'Sprint 2')], milestones: [] },
      all,
    )
    expect(plan.milestones[0].sprints).toEqual(['new:0', 's0'])
    expect(plan.milestones[1].sprints).toEqual([])
    expect(sprintMilestone('new:0', plan.milestones)).toBe('newm:0')
    expect(sprintMilestone('', plan.milestones)).toBe('')
  })

  it('creates milestones first, sprints already linked, then links existing sprints', async () => {
    const calls: string[] = []
    const created = await commitPlan(
      [
        { key: 'new:0', name: 'S1', goal: '', startsOn: '2026-10-12', endsOn: '2026-10-23', keep: true },
        { key: 'new:1', name: 'S2', goal: '', startsOn: '2026-10-26', endsOn: '2026-11-06', keep: true },
      ],
      [
        { key: 'newm:0', name: 'M', description: '', dueOn: '2026-12-04', keep: true, sprints: ['new:0', 'old-sprint'] },
        { key: 'newm:1', name: 'Dropped', description: '', dueOn: '2026-12-04', keep: false, sprints: ['new:1'] },
      ],
      {
        milestone: async (i) => (calls.push(`milestone ${i.name}`), `ms-${i.name}`),
        sprint: async (i, milestoneId) => (calls.push(`sprint ${i.name} -> ${milestoneId}`), `sp-${i.name}`),
        link: async (sprintId, milestoneId) => void calls.push(`link ${sprintId} -> ${milestoneId}`),
      },
    )
    expect(calls).toEqual(['milestone M', 'sprint S1 -> ms-M', 'sprint S2 -> null', 'link old-sprint -> ms-M'])
    expect(created.get('new:1')).toBe('sp-S2')
  })
})

describe('planProblem', () => {
  const s = { key: 'new:0', name: 'Sprint 1', goal: '', startsOn: '2026-10-12', endsOn: '2026-10-23', keep: true }
  it('passes a dated plan and ignores what is left out', () => {
    expect(planProblem([s, { ...s, key: 'new:1', startsOn: '', keep: false }], [])).toBeNull()
  })
  it('asks for missing or backwards dates', () => {
    expect(planProblem([{ ...s, endsOn: '' }], [])).toMatch(/start and an end date/)
    expect(planProblem([{ ...s, endsOn: '2026-10-01' }], [])).toMatch(/ends before it starts/)
    expect(planProblem([], [{ key: 'newm:0', name: 'M', description: '', dueOn: '', keep: true, sprints: [] }])).toMatch(/a date/)
  })
})

describe('commitPlan and resolveKey', () => {
  it('creates only what is kept and maps keys to ids', async () => {
    const made: string[] = []
    const created = await commitPlan(
      [
        { key: 'new:0', name: 'A', goal: '', startsOn: '2026-10-12', endsOn: '2026-10-23', keep: true },
        { key: 'new:1', name: 'B', goal: '', startsOn: '2026-10-26', endsOn: '2026-11-06', keep: false },
      ],
      [{ key: 'newm:0', name: 'M', description: '', dueOn: '2026-12-04', keep: true, sprints: [] }],
      {
        sprint: async (i) => (made.push(i.name), `sprint-${i.name}`),
        milestone: async (i) => (made.push(i.name), `ms-${i.name}`),
      },
    )
    expect(made).toEqual(['M', 'A'])
    expect(resolveKey('new:0', created)).toBe('sprint-A')
    expect(resolveKey('new:1', created)).toBeNull()
    expect(resolveKey('newm:0', created)).toBe('ms-M')
    expect(resolveKey('existing-id', created)).toBe('existing-id')
    expect(resolveKey('', created)).toBeNull()
  })
})

describe('byMilestone', () => {
  it('groups tagged tasks and skips untagged ones', () => {
    expect([
      ...byMilestone([
        { taskId: 't1', milestoneId: 'm1' },
        { taskId: 't2', milestoneId: null },
        { taskId: 't3', milestoneId: 'm1' },
      ]),
    ]).toEqual([['m1', ['t1', 't3']]])
  })
})

describe('addedMessage', () => {
  it('lists what was added', () => {
    expect(addedMessage(1, 0, 0)).toBe('1 task added')
    expect(addedMessage(29, 4, 0)).toBe('29 tasks and 4 sprints added')
    expect(addedMessage(3, 1, 2)).toBe('3 tasks, 1 sprint and 2 milestones added')
  })
})
