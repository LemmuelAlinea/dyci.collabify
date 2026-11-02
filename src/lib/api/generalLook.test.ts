import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getGeneralProject, listJoinRequests, listProjectLooks } from './general'

type Result = { data: unknown; error: unknown }
const results = new Map<string, Result>()

// Every query ends on a promise-like chain; the result is keyed by "table:select".
function chain(key: string) {
  const q: Record<string, unknown> = {}
  const self = () => q
  for (const m of ['eq', 'in', 'order']) q[m] = self
  q.maybeSingle = () => Promise.resolve(results.get(key))
  q.then = (ok: (r: Result | undefined) => unknown, bad?: (e: unknown) => unknown) =>
    Promise.resolve(results.get(key)).then(ok, bad)
  return q
}

vi.mock('../supabase', () => ({
  supabase: { from: (table: string) => ({ select: (cols: string) => chain(`${table}:${cols}`) }) },
}))

const OVERVIEW = 'general_project_overview:*'
const STAGES = 'general_projects:stages, qa_stage, class_board_id'
const RULES =
  'general_projects:default_priority, default_stage, allow_subtasks, allow_dependencies, allow_multiple_assignees, require_assignee, require_subtasks_done'
const LOOK = 'general_projects:color, icon, default_view, visibility'
const MEMBER_RULES = 'general_projects:members_manage_milestones, members_create_tasks'
const MILESTONE_RULES =
  'general_projects:milestone_completion, require_milestone_due, allow_milestone_dependencies, milestone_overdue_alerts'

beforeEach(() => {
  results.clear()
  results.set(OVERVIEW, { data: { id: 'p1', name: 'P' }, error: null })
  results.set(STAGES, { data: { stages: ['A', 'B'], qa_stage: null, class_board_id: null }, error: null })
  results.set(MEMBER_RULES, { data: { members_manage_milestones: false, members_create_tasks: false }, error: null })
  results.set(MILESTONE_RULES, {
    data: { milestone_completion: 'automatic', require_milestone_due: true, allow_milestone_dependencies: true, milestone_overdue_alerts: true },
    error: null,
  })
  results.set(RULES, { data: { default_priority: 'normal', default_stage: 0, allow_subtasks: true, allow_dependencies: true, allow_multiple_assignees: true, require_assignee: false, require_subtasks_done: true }, error: null })
})

describe('getGeneralProject', () => {
  it('returns the look beside the stages', async () => {
    results.set(LOOK, { data: { color: 'teal', icon: 'chart', default_view: 'plan', visibility: 'workspace' }, error: null })
    const p = await getGeneralProject('p1')
    expect(p).toMatchObject({ stages: ['A', 'B'], color: 'teal', icon: 'chart', default_view: 'plan', visibility: 'workspace' })
  })

  it('keeps the stages and uses defaults while the new columns are missing', async () => {
    results.set(LOOK, { data: null, error: { code: '42703', message: 'column general_projects.color does not exist' } })
    const p = await getGeneralProject('p1')
    expect(p).toMatchObject({ stages: ['A', 'B'], color: null, icon: null, default_view: 'overview', visibility: 'private' })
  })
  it('rejects on any other look error instead of reporting defaults', async () => {
    const denied = { code: '42501', message: 'permission denied for table general_projects' }
    results.set(LOOK, { data: null, error: denied })
    await expect(getGeneralProject('p1')).rejects.toBe(denied)
  })
})

describe('listProjectLooks', () => {
  it('returns nothing for no ids', async () => {
    expect(await listProjectLooks([])).toEqual([])
  })

  it('returns [] for a missing column and rethrows anything else', async () => {
    const key = 'general_projects:id, color, icon'
    results.set(key, { data: null, error: { code: '42703', message: 'column general_projects.color does not exist' } })
    expect(await listProjectLooks(['p1'])).toEqual([])
    const other = { code: '42501', message: 'permission denied' }
    results.set(key, { data: null, error: other })
    await expect(listProjectLooks(['p1'])).rejects.toBe(other)
  })
})

describe('listJoinRequests', () => {
  const key = 'general_join_requests:id, project_id, user_id, status, role, created_at, answered_by, answered_at'

  it('returns [] only for a missing table', async () => {
    results.set(key, { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.general_join_requests' in the schema cache" } })
    expect(await listJoinRequests('p1')).toEqual([])
    const other = { code: '42501', message: 'permission denied for table general_join_requests' }
    results.set(key, { data: null, error: other })
    await expect(listJoinRequests('p1')).rejects.toBe(other)
  })
})
