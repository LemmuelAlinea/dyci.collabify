import { beforeEach, expect, it, vi } from 'vitest'
import { listMyArchivedTasks, listSpaceOpenTasks } from './general'
import { searchWorkspace } from './search'

const { from, queries } = vi.hoisted(() => {
  const queries: { table: string; filters: [string, unknown][]; selection: string }[] = []
  return { queries, from: vi.fn((table: string) => {
    const query = { table, filters: [] as [string, unknown][], selection: '' }
    queries.push(query)
    const builder = {
      select: (selection: string) => { query.selection = selection; return builder },
      eq: (key: string, value: unknown) => { query.filters.push([key, value]); return builder },
      in: () => builder, is: () => builder, not: () => builder, neq: () => builder,
      ilike: () => builder, order: () => builder, limit: () => builder,
      then: (resolve: (value: { data: never[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    }
    return builder
  }) }
})
vi.mock('../supabase', () => ({ supabase: { from } }))
beforeEach(() => { queries.length = 0; from.mockClear() })

it('requests only released work for Home, Space overview, My tasks and Calendar', async () => {
  await listSpaceOpenTasks(['project'])
  expect(queries[0].filters).toContainEqual(['routing_state', 'released'])
  await listMyArchivedTasks('viewer', ['project'])
  expect(queries[1].filters).toContainEqual(['routing_state', 'released'])
})

it('restricts task and attachment search before applying result limits', async () => {
  await searchWorkspace('private')
  expect(queries.find(q => q.table === 'general_tasks')?.filters).toContainEqual(['routing_state', 'released'])
  const files = queries.find(q => q.table === 'general_task_files')!
  expect(files.filters).toContainEqual(['general_tasks.routing_state', 'released'])
  expect(files.selection).toContain('general_tasks!inner(')
})
