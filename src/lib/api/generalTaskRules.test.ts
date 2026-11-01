import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addDependency,
  createSubtask,
  getGeneralProject,
  listArchivedTasks,
  listDependencies,
  listMyArchivedTasks,
  listSpaceOpenTasks,
  listTasks,
  removeDependency,
  updateGeneralProject,
} from './general'

type Result = { data: unknown; error: unknown }
const results = new Map<string, Result>()
const calls: { key: string; filters: [string, unknown[]][] }[] = []
const rpcCalls: { name: string; args: unknown }[] = []
const updates: unknown[] = []

// Every query ends on a promise-like chain; the result is keyed by "table:select".
function chain(key: string) {
  const call = { key, filters: [] as [string, unknown[]][] }
  calls.push(call)
  const q: Record<string, unknown> = {}
  const record = (name: string) => (...args: unknown[]) => {
    call.filters.push([name, args])
    return q
  }
  for (const m of ['eq', 'in', 'order', 'is', 'not', 'neq', 'select']) q[m] = record(m)
  q.maybeSingle = () => Promise.resolve(results.get(key))
  q.then = (ok: (r: Result | undefined) => unknown, bad?: (e: unknown) => unknown) =>
    Promise.resolve(results.get(key)).then(ok, bad)
  return q
}

vi.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (cols: string) => chain(`${table}:${cols}`),
      update: (patch: unknown) => {
        updates.push(patch)
        return chain(`${table}:update`)
      },
    }),
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args })
      return Promise.resolve(results.get(`rpc:${name}`) ?? { data: null, error: null })
    },
  },
}))

const missingColumn = { code: '42703', message: 'column general_tasks.priority does not exist' }
const OVERVIEW = 'general_project_overview:*'
const STAGES = 'general_projects:stages, qa_stage, class_board_id'
const LOOK = 'general_projects:color, icon, default_view, visibility'
const RULES =
  'general_projects:default_priority, default_stage, allow_subtasks, allow_dependencies, allow_multiple_assignees, require_assignee, require_subtasks_done'
const TASKS = 'general_task_overview:*'
const EXTRAS = 'general_tasks:id, priority, parent_id'
const DEPS = 'general_task_dependencies:task_id, depends_on_id'

beforeEach(() => {
  results.clear()
  calls.length = 0
  rpcCalls.length = 0
  updates.length = 0
})

describe('getGeneralProject task rules', () => {
  beforeEach(() => {
    results.set(OVERVIEW, { data: { id: 'p1', name: 'P' }, error: null })
    results.set(STAGES, { data: { stages: null, qa_stage: null, class_board_id: null }, error: null })
    results.set(LOOK, { data: { color: null, icon: null, default_view: 'overview', visibility: 'private' }, error: null })
  })

  it('returns the rules from the project row', async () => {
    results.set(RULES, {
      data: {
        default_priority: 'high',
        default_stage: 2,
        allow_subtasks: false,
        allow_dependencies: false,
        allow_multiple_assignees: false,
        require_assignee: true,
        require_subtasks_done: false,
      },
      error: null,
    })
    const p = await getGeneralProject('p1')
    expect(p?.taskRules).toEqual({
      defaultPriority: 'high',
      defaultStage: 2,
      allowSubtasks: false,
      allowDependencies: false,
      allowMultipleAssignees: false,
      requireAssignee: true,
      requireSubtasksDone: false,
    })
  })

  it('reports missing rule columns', async () => {
    const missing = { code: '42703', message: 'column general_projects.default_priority does not exist' }
    results.set(RULES, { data: null, error: missing })
    await expect(getGeneralProject('p1')).rejects.toBe(missing)
  })

  it('rejects on any other rules error', async () => {
    const denied = { code: '42501', message: 'permission denied for table general_projects' }
    results.set(RULES, { data: null, error: denied })
    await expect(getGeneralProject('p1')).rejects.toBe(denied)
  })
})

describe('updateGeneralProject', () => {
  it('passes the snake_case rule columns through', async () => {
    results.set('general_projects:update', { data: [{ id: 'p1' }], error: null })
    await updateGeneralProject('p1', { default_priority: 'urgent', default_stage: 1, allow_subtasks: false, require_assignee: true })
    expect(updates).toEqual([{ default_priority: 'urgent', default_stage: 1, allow_subtasks: false, require_assignee: true }])
  })
})

describe('task priority and parent side read', () => {
  const rows = [
    { id: 't1', title: 'One' },
    { id: 't2', title: 'Two' },
  ]

  it('merges priority and parent_id into every task', async () => {
    results.set(TASKS, { data: rows, error: null })
    results.set(EXTRAS, {
      data: [
        { id: 't1', priority: 'urgent', parent_id: null },
        { id: 't2', priority: 'low', parent_id: 't1' },
      ],
      error: null,
    })
    const tasks = await listTasks('p1')
    expect(tasks).toMatchObject([
      { id: 't1', title: 'One', priority: 'urgent', parent_id: null },
      { id: 't2', title: 'Two', priority: 'low', parent_id: 't1' },
    ])
  })

  it('reads the extras with one query for the whole list', async () => {
    results.set(TASKS, { data: rows, error: null })
    results.set(EXTRAS, { data: [], error: null })
    await listTasks('p1')
    expect(calls.filter((c) => c.key === EXTRAS)).toHaveLength(1)
    expect(calls.find((c) => c.key === EXTRAS)?.filters).toContainEqual(['in', ['id', ['t1', 't2']]])
  })

  it('does not query the extras for an empty list', async () => {
    results.set(TASKS, { data: [], error: null })
    expect(await listTasks('p1')).toEqual([])
    expect(calls.some((c) => c.key === EXTRAS)).toBe(false)
  })

  it('defaults a task the side read did not return', async () => {
    results.set(TASKS, { data: rows, error: null })
    results.set(EXTRAS, { data: [{ id: 't1', priority: 'high', parent_id: null }], error: null })
    const tasks = await listTasks('p1')
    expect(tasks[1]).toMatchObject({ id: 't2', priority: 'normal', parent_id: null })
  })

  it('reports missing task columns', async () => {
    results.set(TASKS, { data: rows, error: null })
    results.set(EXTRAS, { data: null, error: missingColumn })
    await expect(listTasks('p1')).rejects.toBe(missingColumn)
  })

  it('rethrows any other side read error', async () => {
    const denied = { code: '42501', message: 'permission denied for table general_tasks' }
    results.set(TASKS, { data: rows, error: null })
    results.set(EXTRAS, { data: null, error: denied })
    await expect(listTasks('p1')).rejects.toBe(denied)
  })

  it('reaches My tasks, the space overview and the archive too', async () => {
    results.set(TASKS, { data: rows, error: null })
    results.set(EXTRAS, { data: [{ id: 't1', priority: 'high', parent_id: null }], error: null })
    expect((await listSpaceOpenTasks(['p1']))[0].priority).toBe('high')
    expect((await listArchivedTasks('p1'))[0].priority).toBe('high')
    expect((await listMyArchivedTasks('u1', ['p1']))[0].priority).toBe('high')
  })

  it('splits a long list so a request stays short', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ id: `t${i}` }))
    results.set(TASKS, { data: many, error: null })
    results.set(EXTRAS, { data: [], error: null })
    const tasks = await listTasks('p1')
    expect(tasks).toHaveLength(250)
    expect(calls.filter((c) => c.key === EXTRAS)).toHaveLength(3)
  })
})

describe('dependencies and subtasks', () => {
  it('lists the links of a project', async () => {
    results.set(DEPS, { data: [{ task_id: 'a', depends_on_id: 'b' }], error: null })
    expect(await listDependencies('p1')).toEqual([{ task_id: 'a', depends_on_id: 'b' }])
    expect(calls.find((c) => c.key === DEPS)?.filters).toContainEqual(['eq', ['project_id', 'p1']])
  })

  it('reports a missing dependency table', async () => {
    const missing = { code: 'PGRST205', message: "Could not find the table 'public.general_task_dependencies' in the schema cache" }
    results.set(DEPS, {
      data: null,
      error: missing,
    })
    await expect(listDependencies('p1')).rejects.toBe(missing)
    const other = { code: '42501', message: 'permission denied for table general_task_dependencies' }
    results.set(DEPS, { data: null, error: other })
    await expect(listDependencies('p1')).rejects.toBe(other)
  })

  it('creates a subtask through the RPC and returns its id', async () => {
    results.set('rpc:create_general_subtask', { data: 'new-id', error: null })
    expect(await createSubtask('parent', ' Title ', 'About', '2026-12-01T00:00:00Z')).toBe('new-id')
    expect(rpcCalls[0]).toEqual({
      name: 'create_general_subtask',
      args: { p_parent: 'parent', p_title: 'Title', p_description: 'About', p_due_at: '2026-12-01T00:00:00Z' },
    })
  })

  it('defaults the subtask description and due date', async () => {
    results.set('rpc:create_general_subtask', { data: 'x', error: null })
    await createSubtask('parent', 'Title')
    expect(rpcCalls[0].args).toEqual({ p_parent: 'parent', p_title: 'Title', p_description: '', p_due_at: null })
  })

  it('adds and removes a link through the RPCs', async () => {
    await addDependency('a', 'b')
    await removeDependency('a', 'b')
    expect(rpcCalls).toEqual([
      { name: 'add_general_task_dependency', args: { p_task: 'a', p_depends_on: 'b' } },
      { name: 'remove_general_task_dependency', args: { p_task: 'a', p_depends_on: 'b' } },
    ])
  })

  it('throws RPC errors as they are', async () => {
    const err = { code: 'P0001', message: 'No loops' }
    results.set('rpc:add_general_task_dependency', { data: null, error: err })
    await expect(addDependency('a', 'b')).rejects.toBe(err)
    results.set('rpc:create_general_subtask', { data: null, error: err })
    await expect(createSubtask('a', 't')).rejects.toBe(err)
  })
})
