import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemberTask, createTask } from '../../lib/api/general'
import { generalMilestoneSource, generalWorkSource } from './workSource'
import type { GeneralProjectState } from './useGeneralProject'

vi.mock('../../lib/api/general', () => ({ createTask: vi.fn(async () => 't-new'), createMemberTask: vi.fn(async () => 't-member') }))
vi.mock('../../lib/api/milestones', () => ({}))
vi.mock('../../lib/api/sprints', () => ({}))

const reload = vi.fn(async () => {})

function makeState(
  myRole: string,
  memberRules: { manageMilestones: boolean; createTasks: boolean },
  over: Record<string, unknown> = {},
) {
  return {
    project: { id: 'p1', class_board_id: null, memberRules },
    myRole,
    viewerId: 'me',
    readOnly: false,
    archived: false,
    tasks: [],
    sprints: [],
    milestones: [],
    teams: [],
    teamMembers: [],
    sprintSettings: undefined,
    // A Member holds no manage_tasks, so the planners' switch stays off for them.
    can: (p: string) => myRole === 'pm' || myRole === 'coordinator' ? p !== 'edit_project' || myRole === 'pm' : false,
    leadsUser: () => false,
    nameOf: (id: string) => id,
    reload,
    ...over,
  } as unknown as GeneralProjectState
}

const off = { manageMilestones: false, createTasks: false }
const on = { manageMilestones: true, createTasks: true }

beforeEach(() => vi.clearAllMocks())

describe('generalWorkSource', () => {
  it('offers a Member Add task only while the task switch is on', () => {
    expect(generalWorkSource(makeState('member', off), vi.fn()).canAdd).toBe(false)
    expect(generalWorkSource(makeState('member', { ...off, manageMilestones: true }), vi.fn()).canAdd).toBe(false)
    expect(generalWorkSource(makeState('member', on), vi.fn()).canAdd).toBe(true)
  })

  it('keeps the planners and QA adding, and stakeholders out, whatever the switch says', () => {
    expect(generalWorkSource(makeState('pm', off), vi.fn()).canAdd).toBe(true)
    expect(generalWorkSource(makeState('coordinator', off), vi.fn()).canAdd).toBe(true)
    expect(generalWorkSource(makeState('qa', off), vi.fn()).canAdd).toBe(true)
    expect(generalWorkSource(makeState('stakeholder', on), vi.fn()).canAdd).toBe(false)
  })

  it('offers nothing while the project is read-only', () => {
    expect(generalWorkSource(makeState('member', on, { readOnly: true }), vi.fn()).canAdd).toBe(false)
  })

  it('sends a Member backlog task through createMemberTask and not createTask', async () => {
    const source = generalWorkSource(makeState('member', on), vi.fn())
    await source.addToBacklog!('Draft the survey')
    expect(createMemberTask).toHaveBeenCalledWith('p1', 'Draft the survey')
    expect(createTask).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalled()
  })

  it('tells a Member where the task went, and tells nobody else anything', () => {
    expect(generalWorkSource(makeState('member', on), vi.fn()).addedMessage).toBe('Sent to planners for review')
    expect(generalWorkSource(makeState('pm', on), vi.fn()).addedMessage).toBeUndefined()
    expect(generalWorkSource(makeState('qa', on), vi.fn()).addedMessage).toBeUndefined()
  })

  it('gives a Member their own backlog placeholder', () => {
    expect(generalWorkSource(makeState('member', on), vi.fn()).addPlaceholder).toBe('Suggest a task for the planners')
    expect(generalWorkSource(makeState('pm', on), vi.fn()).addPlaceholder).toBeUndefined()
  })

  it('keeps a class board member on createTask', async () => {
    const state = makeState('member', on)
    state.project!.class_board_id = 'c1'
    const source = generalWorkSource(state, vi.fn())
    expect(source.addedMessage).toBeUndefined()
    await source.addToBacklog!('Read chapter 2')
    expect(createTask).toHaveBeenCalled()
    expect(createMemberTask).not.toHaveBeenCalled()
  })

  it('keeps createTask for the project manager, and for QA as a bug', async () => {
    await generalWorkSource(makeState('pm', on), vi.fn()).addToBacklog!('Plan it')
    expect(createTask).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: 'p1', title: 'Plan it', kind: undefined }))
    await generalWorkSource(makeState('qa', on), vi.fn()).addToBacklog!('Broken')
    expect(createTask).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Broken', kind: 'bug' }))
    expect(createMemberTask).not.toHaveBeenCalled()
  })
})

describe('generalMilestoneSource', () => {
  it('gives a Member the milestone controls only when the switch is on, and never tagging', () => {
    const closed = generalMilestoneSource(makeState('member', off), vi.fn())
    expect([closed.canManage, closed.canMarkReached, closed.canTag]).toEqual([false, false, false])
    const open = generalMilestoneSource(makeState('member', { ...off, manageMilestones: true }), vi.fn())
    expect([open.canManage, open.canMarkReached, open.canTag]).toEqual([true, true, false])
    expect(open.readOnlyReason).not.toBe('')
  })

  it('keeps every milestone control for a planner', () => {
    const source = generalMilestoneSource(makeState('pm', off), vi.fn())
    expect([source.canManage, source.canMarkReached, source.canTag]).toEqual([true, true, true])
    expect(source.readOnlyReason).toBe('')
  })

  it('hands the milestone settings and links to the view, and lets managers link', () => {
    const rules = { completion: 'manual', requireDue: false, allowDependencies: false, overdueAlerts: true }
    const links = [{ milestone_id: 'b', depends_on_id: 'a' }]
    const state = makeState('pm', off, { milestoneDependencies: links })
    state.project!.milestoneRules = rules as never
    const source = generalMilestoneSource(state, vi.fn())
    expect(source).toMatchObject({ completion: 'manual', requireDue: false, allowLinks: false, canLink: true, dependencies: links })
    expect(generalMilestoneSource(makeState('member', off), vi.fn()).canLink).toBe(false)
    expect(generalMilestoneSource(makeState('member', { ...off, manageMilestones: true }), vi.fn()).canLink).toBe(true)
  })

  it('reads the defaults while the project has no settings', () => {
    const source = generalMilestoneSource(makeState('pm', off), vi.fn())
    expect(source).toMatchObject({ completion: 'automatic', requireDue: true, allowLinks: true, dependencies: [] })
  })

  it('gives QA and stakeholders nothing, and a read-only project nothing', () => {
    for (const role of ['qa', 'stakeholder']) {
      const source = generalMilestoneSource(makeState(role, on), vi.fn())
      expect([source.canManage, source.canMarkReached, source.canTag]).toEqual([false, false, false])
    }
    const archived = generalMilestoneSource(makeState('member', on, { readOnly: true, archived: true }), vi.fn())
    expect([archived.canManage, archived.canMarkReached, archived.canTag]).toEqual([false, false, false])
  })
})
