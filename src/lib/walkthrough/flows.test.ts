import { describe, expect, it } from 'vitest'
import type { GeneralSpaceSummary } from '../general/types'
import { paths } from '../paths'
import { FLOWS, flowsFor, type StepId, type WalkthroughFacts } from './flows'

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

const space = (over: Partial<GeneralSpaceSummary> = {}): GeneralSpaceSummary =>
  ({
    id: 's1',
    kind: 'work',
    name: 'Space',
    description: '',
    created_by: null,
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    class_id: null,
    my_level: 'owner',
    my_role: 'pm',
    member_count: 1,
    project_count: 0,
    archived_count: 0,
    ...over,
  }) as GeneralSpaceSummary

const step = (id: StepId) => {
  const found = Object.values(FLOWS)
    .flat()
    .find((s) => s.id === id)
  if (!found) throw new Error(`no step ${id}`)
  return found
}

describe('flowsFor', () => {
  it('orders teaching before project manager', () =>
    expect(flowsFor(facts({ profile: both }))).toEqual(['teaching', 'project_manager']))
  it('gives a student the student walkthrough', () =>
    expect(
      flowsFor(facts({ profile: { ...manager, role: 'student', can_manage_projects: false } })),
    ).toEqual(['student']))
  it('gives a plain member the member walkthrough', () => expect(flowsFor(facts())).toEqual(['member']))
  it('gives a stakeholder-only member nothing', () =>
    expect(flowsFor(facts({ stakeholderOnly: true }))).toEqual([]))
  it('gives an admin with the switch nothing', () =>
    expect(flowsFor(facts({ profile: { ...manager, role: 'admin' } }))).toEqual([]))
  it('gives a pending account nothing', () =>
    expect(flowsFor(facts({ profile: { ...manager, status: 'pending' } }))).toEqual([]))
})

describe('step data', () => {
  it('create-space is done with a live PM space only', () => {
    const s = step('create-space')
    expect(s.isDone?.(facts({ spaces: [space()] }))).toBe(true)
    expect(s.isDone?.(facts({ spaces: [space({ archived_at: '2026-02-01T00:00:00Z' })] }))).toBe(false)
    expect(s.isDone?.(facts({ spaces: [space({ my_role: 'member' })] }))).toBe(false)
  })

  it('start-project routes to the newest PM space and is done with a project', () => {
    const s = step('start-project')
    const spaces = [
      space({ id: 'old', created_at: '2026-01-01T00:00:00Z' }),
      space({ id: 'new', created_at: '2026-03-01T00:00:00Z' }),
    ]
    expect(s.route(facts({ spaces }))).toBe(paths.spaceProjects('new'))
    expect(s.route(facts())).toBeNull()
    expect(s.isDone?.(facts({ spaces }))).toBe(false)
    expect(s.isDone?.(facts({ spaces: [...spaces, space({ id: 'x', project_count: 2 })] }))).toBe(true)
  })

  it('create-class and share-code read the taught classes', () => {
    const cls = (over: Partial<GeneralSpaceSummary>) =>
      space({ kind: 'education', my_role: null, my_level: 'owner', class_id: 'c1', ...over })
    expect(step('create-class').isDone?.(facts({ spaces: [cls({})] }))).toBe(true)
    expect(step('create-class').isDone?.(facts({ spaces: [cls({ my_level: 'member' })] }))).toBe(false)
    const spaces = [
      cls({ class_id: 'old', created_at: '2026-01-01T00:00:00Z' }),
      cls({ class_id: 'new', created_at: '2026-03-01T00:00:00Z' }),
    ]
    expect(step('share-code').route(facts({ spaces }))).toBe(paths.class('new'))
    expect(step('share-code').route(facts())).toBeNull()
  })

  it('reads class and inbox facts', () => {
    expect(step('join-class').isDone?.(facts({ inClass: true }))).toBe(true)
    expect(step('join-class').isDone?.(facts())).toBe(false)
    expect(step('join-class').pauseLabel).toBe("I don't have a code yet")
    expect(step('watch-inbox').isDone?.(facts({ hasWork: true }))).toBe(true)
    expect(step('watch-inbox').isDone?.(facts({ inClass: true }))).toBe(true)
    expect(step('watch-inbox').isDone?.(facts())).toBe(false)
  })

  it('find-work routes to the newest live class they are in, else Home', () => {
    const s = step('find-work')
    const cls = (over: Partial<GeneralSpaceSummary>) =>
      space({ kind: 'education', my_role: null, my_level: 'member', class_id: 'c1', ...over })
    expect(s.route(facts())).toBe(paths.home)
    expect(
      s.route(
        facts({
          spaces: [
            cls({ class_id: 'old', created_at: '2026-01-01T00:00:00Z' }),
            cls({ class_id: 'new', created_at: '2026-03-01T00:00:00Z' }),
            cls({ class_id: 'gone', created_at: '2026-04-01T00:00:00Z', archived_at: '2026-05-01T00:00:00Z' }),
            cls({ class_id: 'left', created_at: '2026-04-01T00:00:00Z', my_level: null }),
            cls({ class_id: null, created_at: '2026-04-01T00:00:00Z' }),
            space({ id: 'work', created_at: '2026-04-01T00:00:00Z', class_id: 'not-a-class' }),
          ],
        }),
      ),
    ).toBe(paths.class('new'))
    expect(s.route(facts({ spaces: [cls({ my_level: null })] }))).toBe(paths.home)
  })
})
