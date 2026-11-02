import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addMilestoneDependency,
  createMilestone,
  listMilestoneDependencies,
  listMilestones,
  removeMilestoneDependency,
  updateMilestone,
} from './milestones'

type Result = { data: unknown; error: unknown }
const results = new Map<string, Result>()
const selects: string[] = []
const inserts: unknown[] = []
const updates: unknown[] = []
const rpcCalls: { name: string; args: unknown }[] = []

// Every query ends on a promise-like chain; the result is keyed by "table:select".
function chain(key: string) {
  const q: Record<string, unknown> = {}
  const self = () => q
  for (const m of ['eq', 'order', 'select']) q[m] = self
  q.single = () => Promise.resolve(results.get(key))
  q.then = (ok: (r: Result | undefined) => unknown, bad?: (e: unknown) => unknown) =>
    Promise.resolve(results.get(key)).then(ok, bad)
  return q
}

vi.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (cols: string) => {
        selects.push(`${table}:${cols}`)
        return chain(`${table}:${cols}`)
      },
      insert: (row: unknown) => {
        inserts.push(row)
        return chain(`${table}:insert`)
      },
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

const WITH_AUTO = 'general_milestones:id, name, description, due_on, reached_at, reached_auto, created_at'
const WITHOUT_AUTO = 'general_milestones:id, name, description, due_on, reached_at, created_at'
const missingColumn = { code: '42703', message: 'column general_milestones.reached_auto does not exist' }
const missingTable = { code: 'PGRST205', message: "Could not find the table 'public.general_milestone_dependencies' in the schema cache" }

beforeEach(() => {
  results.clear()
  selects.length = 0
  inserts.length = 0
  updates.length = 0
  rpcCalls.length = 0
})

describe('listMilestones', () => {
  it('reads reached_auto and keeps an undated milestone undated', async () => {
    results.set(WITH_AUTO, {
      data: [{ id: 'a', name: 'A', description: '', due_on: null, reached_at: '2026-10-01T00:00:00Z', reached_auto: true, created_at: 't' }],
      error: null,
    })
    expect(await listMilestones({ kind: 'work', projectId: 'p1' })).toEqual([
      { id: 'a', name: 'A', description: '', due_on: null, reached_at: '2026-10-01T00:00:00Z', reached_auto: true, created_at: 't' },
    ])
  })

  it('reads again without reached_auto while the column is missing', async () => {
    results.set(WITH_AUTO, { data: null, error: missingColumn })
    results.set(WITHOUT_AUTO, { data: [{ id: 'a', name: 'A', description: '', due_on: '2026-10-20', reached_at: null, created_at: 't' }], error: null })
    const list = await listMilestones({ kind: 'work', projectId: 'p1' })
    expect(selects).toEqual([WITH_AUTO, WITHOUT_AUTO])
    expect(list).toHaveLength(1)
    expect(list[0].reached_at).toBeNull()
  })

  it('rethrows any other error', async () => {
    const denied = { code: '42501', message: 'permission denied' }
    results.set(WITH_AUTO, { data: null, error: denied })
    await expect(listMilestones({ kind: 'work', projectId: 'p1' })).rejects.toBe(denied)
  })
})

describe('saving a milestone', () => {
  it('sends an empty date as no due date', async () => {
    results.set('general_milestones:insert', { data: { id: 'new' }, error: null })
    results.set('general_milestones:update', { data: [{ id: 'a' }], error: null })
    const home = { kind: 'work', projectId: 'p1' } as const
    await createMilestone(home, { name: ' Beta ', description: '', dueOn: '' })
    await updateMilestone(home, 'a', { name: 'Beta', description: '', dueOn: '2026-10-20' })
    expect(inserts).toEqual([{ project_id: 'p1', name: 'Beta', description: '', due_on: null }])
    expect(updates).toEqual([{ name: 'Beta', description: '', due_on: '2026-10-20' }])
  })
})

describe('listMilestoneDependencies', () => {
  const KEY = 'general_milestone_dependencies:milestone_id, depends_on_id'

  it('returns the links of a project', async () => {
    results.set(KEY, { data: [{ milestone_id: 'b', depends_on_id: 'a' }], error: null })
    expect(await listMilestoneDependencies('p1')).toEqual([{ milestone_id: 'b', depends_on_id: 'a' }])
  })

  it('returns none while the table is missing, and rethrows any other error', async () => {
    results.set(KEY, { data: null, error: missingTable })
    expect(await listMilestoneDependencies('p1')).toEqual([])
    const denied = { code: '42501', message: 'permission denied' }
    results.set(KEY, { data: null, error: denied })
    await expect(listMilestoneDependencies('p1')).rejects.toBe(denied)
  })
})

describe('milestone links', () => {
  it('adds and removes through the database functions', async () => {
    await addMilestoneDependency('b', 'a')
    await removeMilestoneDependency('b', 'a')
    expect(rpcCalls).toEqual([
      { name: 'add_general_milestone_dependency', args: { p_milestone: 'b', p_depends_on: 'a' } },
      { name: 'remove_general_milestone_dependency', args: { p_milestone: 'b', p_depends_on: 'a' } },
    ])
  })

  it('throws the database message so the screen can show it', async () => {
    const refused = { message: 'Milestone dependencies are turned off for this project.' }
    results.set('rpc:add_general_milestone_dependency', { data: null, error: refused })
    await expect(addMilestoneDependency('b', 'a')).rejects.toBe(refused)
  })
})
