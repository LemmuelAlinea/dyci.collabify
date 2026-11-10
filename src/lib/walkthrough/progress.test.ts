import { describe, expect, it } from 'vitest'
import type { GeneralSpaceSummary } from '../general/types'
import type { ProgressRow } from '../api/walkthroughs'
import type { FlowId, WalkthroughFacts } from './flows'
import {
  markPaused,
  markSkipped,
  markStep,
  replaySteps,
  resolveRun,
  toMap,
  type ProgressMap,
} from './progress'

const facts = (over: Partial<WalkthroughFacts> = {}): WalkthroughFacts => ({
  profile: { role: 'member', status: 'active', can_teach: false, can_manage_projects: false },
  stakeholderOnly: false,
  inClass: false,
  hasWork: false,
  spaces: [],
  ...over,
})
const manager = { role: 'member', status: 'active', can_teach: false, can_manage_projects: true } as const
const both = { ...manager, can_teach: true }
const student = { ...manager, role: 'student', can_manage_projects: false } as const

const opened = new Set<FlowId>(['teaching', 'project_manager', 'student', 'member'])
const run = (f: WalkthroughFacts, p: ProgressMap = {}, held = false) =>
  resolveRun(f, p, { openedWith: opened, held })

const row = (
  flow: ProgressRow['flow'],
  status: ProgressRow['status'],
  done_steps: string[] = [],
): ProgressRow => ({ flow, status, done_steps })
const done = row('account', 'done')

const classSpace = {
  kind: 'education',
  my_level: 'owner',
  my_role: null,
  class_id: 'c1',
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
} as unknown as GeneralSpaceSummary

describe('resolveRun', () => {
  it('starts with the account step', () => {
    const r = run(facts())
    expect(r).toMatchObject({ kind: 'step', flow: 'member', index: 1, total: 3 })
    expect(r.kind === 'step' && r.step.id).toBe('account-photo')
  })

  it('shows the account step once', () => {
    const r = run(facts({ profile: both }), toMap([done]))
    expect(r).toMatchObject({ kind: 'step', flow: 'teaching', index: 1, total: 2 })
    expect(r.kind === 'step' && r.step.id).toBe('create-class')
  })

  it('puts teaching first, project manager after', () => {
    const r = run(facts({ profile: both }), toMap([done, row('teaching', 'done')]))
    expect(r.kind === 'step' && r.step.id).toBe('create-space')
  })

  it('resumes past a done step', () => {
    const teacher = { ...manager, can_teach: true, can_manage_projects: false }
    const r = run(facts({ profile: teacher, spaces: [classSpace] }), toMap([done]))
    expect(r.kind === 'step' && r.step.id).toBe('share-code')
  })

  it('never returns a skipped walkthrough', () =>
    expect(run(facts({ profile: student }), toMap([row('student', 'skipped')]))).toEqual({ kind: 'none' }))

  it('waits for the next open while held', () => {
    const p = toMap([done, row('teaching', 'skipped')])
    expect(run(facts({ profile: both }), p, true)).toEqual({ kind: 'none' })
    const r = run(facts({ profile: both }), p, false)
    expect(r.kind === 'step' && r.step.id).toBe('create-space')
  })

  it('makes a switch turned on after opening wait', () =>
    expect(
      resolveRun(facts({ profile: manager }), toMap([done]), {
        openedWith: new Set<FlowId>(['member']),
        held: false,
      }),
    ).toEqual({ kind: 'none' }))

  it('stops a walkthrough whose switch is turned off', () => {
    const r = run(facts(), toMap([done, row('project_manager', 'active')]))
    expect(r).toMatchObject({ kind: 'step', flow: 'member' })
  })

  it('holds at the join step while paused', () =>
    expect(run(facts({ profile: student }), toMap([done, row('student', 'paused')]))).toEqual({
      kind: 'paused',
      flow: 'student',
    }))

  it('resumes after joining', () => {
    const r = run(facts({ profile: student, inClass: true }), toMap([done, row('student', 'paused')]))
    expect(r.kind === 'step' && r.step.id).toBe('find-work')
  })

  it('finishes when everything is satisfied', () =>
    expect(
      run(
        facts({ profile: student, inClass: true }),
        toMap([done, row('student', 'active', ['find-work'])]),
      ),
    ).toEqual({ kind: 'finished', flow: 'student' }))

  it('gives a member with work the account step only', () =>
    expect(run(facts({ hasWork: true }), toMap([done]))).toEqual({ kind: 'finished', flow: 'member' }))
})

describe('changes', () => {
  const [photo, look] = replaySteps(facts())

  it('closes the account row on the last account step', () => {
    const first = markStep({}, photo)
    const second = markStep(first.progress, look)
    expect(second.writes).toEqual([
      { flow: 'account', status: 'done', done_steps: ['account-photo', 'account-look'] },
    ])
  })

  it('consumes an unfinished account step when skipping', () => {
    const c = markSkipped({}, 'member')
    expect(c.writes.map((w) => [w.flow, w.status])).toEqual([
      ['member', 'skipped'],
      ['account', 'skipped'],
    ])
  })

  it('leaves a done account row alone when skipping', () =>
    expect(markSkipped(toMap([done]), 'member').writes).toHaveLength(1))

  it('pauses a flow', () =>
    expect(markPaused({}, 'student').writes).toEqual([
      { flow: 'student', status: 'paused', done_steps: [] },
    ]))
})

describe('replaySteps', () => {
  it('lists a student walk', () =>
    expect(replaySteps(facts({ profile: student })).map((s) => s.id)).toEqual([
      'account-photo',
      'account-look',
      'join-class',
      'find-work',
    ]))
  it('is empty without a walkthrough', () =>
    expect(replaySteps(facts({ stakeholderOnly: true }))).toEqual([]))
})
