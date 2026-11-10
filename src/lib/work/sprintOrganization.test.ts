import { describe, expect, it } from 'vitest'
import { defaultScope, readScope, scopeOptions, scopeSprintId } from './scope'
import { canStartSprint, nextSprintDraft, runningSprints, runningTabs, sprintTargetLabel } from './sprints'
import { DEFAULT_SPRINT_SETTINGS } from './sprintSettings'
import type { Sprint, WorkItem } from './types'

const sprint = (over: Partial<Sprint>): Sprint => ({
  id: 's',
  name: 'Sprint',
  goal: '',
  starts_on: '2026-10-05',
  ends_on: '2026-10-18',
  state: 'planned',
  archived: false,
  started_at: null,
  completed_at: null,
  created_at: '2026-10-01T00:00:00Z',
  milestone_id: null,
  team_id: null,
  ...over,
})

const item = (over: Partial<WorkItem>): WorkItem => ({
  id: 't',
  title: 'Task',
  status: 'todo',
  due_at: null,
  done_at: null,
  sprint_id: 'p',
  milestone_id: null,
  rank: 1,
  holders: [],
  created_at: '2026-10-01T00:00:00Z',
  ...over,
})

const teamName = (id: string) => ({ f: 'Frontend', b: 'Backend' })[id]

describe('runningSprints', () => {
  it('sorts the running sprints by the one ending soonest', () => {
    const list = [
      sprint({ id: 'late', state: 'active', ends_on: '2026-11-20' }),
      sprint({ id: 'planned', ends_on: '2026-10-01' }),
      sprint({ id: 'soon', state: 'active', ends_on: '2026-11-01' }),
    ]
    expect(runningSprints(list).map((s) => s.id)).toEqual(['soon', 'late'])
  })
})

describe('canStartSprint', () => {
  const planned = sprint({ id: 'p', name: 'Next', team_id: 'f' })

  it('allows one running sprint in sequential', () => {
    expect(canStartSprint(planned, [planned], 'sequential')).toBeNull()
    const other = sprint({ id: 'r', name: 'Sprint 1', state: 'active' })
    expect(canStartSprint(planned, [planned, other], 'sequential')).toBe('Finish Sprint 1 first.')
  })

  it('never blocks in parallel', () => {
    const other = sprint({ id: 'r', state: 'active' })
    expect(canStartSprint(sprint({ id: 'p' }), [other], 'parallel')).toBeNull()
  })

  it('needs a team in streams', () => {
    expect(canStartSprint(sprint({ id: 'p' }), [], 'streams')).toBe('Give this sprint a team first.')
  })

  it('allows one running sprint per team in streams', () => {
    const other = sprint({ id: 'r', name: 'Front 1', state: 'active', team_id: 'f' })
    expect(canStartSprint(planned, [planned, other], 'streams', { teamName })).toBe(
      'Frontend is already running Front 1.',
    )
    const elsewhere = sprint({ id: 'r', name: 'Back 1', state: 'active', team_id: 'b' })
    expect(canStartSprint(planned, [planned, elsewhere], 'streams', { teamName })).toBeNull()
  })

  it('counts open tasks of another team in streams', () => {
    const one = [item({ teamId: 'b' }), item({ id: 'd', teamId: 'b', status: 'done' })]
    expect(canStartSprint(planned, [planned], 'streams', { items: one })).toBe(
      '1 task in this sprint belongs to another team. Move it out first.',
    )
    const two = [item({ teamId: 'b' }), item({ id: 'n', teamId: null })]
    expect(canStartSprint(planned, [planned], 'streams', { items: two })).toBe(
      '2 tasks in this sprint belong to another team. Move them out first.',
    )
    expect(canStartSprint(planned, [planned], 'streams', { items: [item({ teamId: 'f' })] })).toBeNull()
  })
})

describe('nextSprintDraft for a team', () => {
  it('names and dates the sprint from that team alone', () => {
    const list = [
      sprint({ id: 'a', team_id: 'f', ends_on: '2026-11-01' }),
      sprint({ id: 'b', team_id: 'b', ends_on: '2026-12-31' }),
    ]
    const draft = nextSprintDraft(list, new Date(2026, 9, 1).getTime(), DEFAULT_SPRINT_SETTINGS, { id: 'f', name: 'Frontend' })
    expect(draft.name).toBe('Frontend sprint 2')
    expect(draft.teamId).toBe('f')
    expect(draft.startsOn >= '2026-11-02').toBe(true)
    expect(draft.startsOn < '2026-12-01').toBe(true)
  })
})

describe('runningTabs', () => {
  const teams = [
    { id: 'b', name: 'Backend', leader_id: null },
    { id: 'f', name: 'Frontend', leader_id: null },
    { id: 'd', name: 'Design', leader_id: null },
  ]
  const front = sprint({ id: 'sf', name: 'Front 1', state: 'active', team_id: 'f', ends_on: '2026-11-20' })
  const back = sprint({ id: 'sb', name: 'Back 1', state: 'active', team_id: 'b', ends_on: '2026-11-01' })

  it('shows no tabs in sequential', () => {
    expect(runningTabs([front, back], 'sequential', teams, [])).toEqual([])
  })

  it('shows a tab per team in streams, the viewer first, idle teams last and greyed', () => {
    const tabs = runningTabs([front, back], 'streams', teams, ['f'])
    expect(tabs.map((t) => [t.key, t.label, t.sprint?.id ?? null])).toEqual([
      ['f', 'Frontend', 'sf'],
      ['b', 'Backend', 'sb'],
      ['d', 'Design', null],
    ])
  })

  it('leaves archived teams out', () => {
    const tabs = runningTabs([front], 'streams', [teams[1], { id: 'x', name: 'Old', archived_at: '2026-10-01' }, { id: 'd', name: 'Design' }], [])
    expect(tabs.map((t) => t.label)).toEqual(['Frontend', 'Design'])
  })

  it('shows a tab per sprint in parallel, ending soonest first', () => {
    const tabs = runningTabs([front, back], 'parallel', teams, ['f'])
    expect(tabs.map((t) => t.label)).toEqual(['Back 1', 'Front 1'])
  })

  it('shows no tabs for one running sprint in parallel', () => {
    expect(runningTabs([front], 'parallel', teams, [])).toEqual([])
  })
})

describe('sprintTargetLabel', () => {
  it('names a running sprint with its team', () => {
    expect(sprintTargetLabel(sprint({ name: 'Sprint 3', state: 'active', team_id: 'f' }), teamName)).toBe('Sprint 3 · Frontend · running')
    expect(sprintTargetLabel(sprint({ name: 'Sprint 3', state: 'active' }), teamName)).toBe('Sprint 3 (running)')
    expect(sprintTargetLabel(sprint({ name: 'Sprint 4', team_id: 'f' }), teamName)).toBe('Sprint 4 · Frontend')
    expect(sprintTargetLabel(sprint({ name: 'Sprint 4' }), teamName)).toBe('Sprint 4')
  })
})

describe('scope with several running sprints', () => {
  const soon = sprint({ id: 'soon', name: 'One', state: 'active', ends_on: '2026-11-01' })
  const late = sprint({ id: 'late', name: 'Two', state: 'active', ends_on: '2026-11-20' })

  it('offers one entry per running sprint', () => {
    expect(scopeOptions([late, soon]).slice(0, 2)).toEqual([
      { value: 'running:soon', label: 'Running · One' },
      { value: 'running:late', label: 'Running · Two' },
    ])
  })

  it('keeps old running links working, as the first entry', () => {
    expect(readScope('running', [late, soon])).toBe('running:soon')
    expect(defaultScope([late, soon])).toBe('running:soon')
    expect(scopeSprintId('running', [late, soon])).toBe('soon')
  })

  it('reads and resolves one running sprint', () => {
    expect(readScope('running:late', [late, soon])).toBe('running:late')
    expect(scopeSprintId('running:late', [late, soon])).toBe('late')
    expect(readScope('running:gone', [late, soon])).toBe('running:soon')
  })

  it('stays as it was with one running sprint', () => {
    expect(defaultScope([soon])).toBe('running')
    expect(readScope('running', [soon])).toBe('running')
    expect(scopeOptions([soon])[0]).toEqual({ value: 'running', label: 'Running sprint · One' })
  })
})
