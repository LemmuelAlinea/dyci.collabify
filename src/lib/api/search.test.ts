import { beforeEach, expect, it, vi } from 'vitest'
import { searchWorkspace } from './search'

/** Each table answers with its own rows; every filter is a no-op. */
const { from, rows } = vi.hoisted(() => {
  const rows: Record<string, unknown[]> = {}
  return {
    rows,
    from: vi.fn((table: string) => {
      const builder = {
        select: () => builder, eq: () => builder, in: () => builder, is: () => builder,
        not: () => builder, neq: () => builder, ilike: () => builder, order: () => builder, limit: () => builder,
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve),
      }
      return builder
    }),
  }
})
vi.mock('../supabase', () => ({ supabase: { from } }))

const project = { title: 'Capstone', archived_at: null, trashed_at: null }

beforeEach(() => {
  for (const k of Object.keys(rows)) delete rows[k]
  rows.general_blobs = [
    { repo_id: 'r1', project_id: 'gp1', path: 'report/notes.md', action: 'added', seq: 2 },
    { repo_id: 'r2', project_id: 'gp2', path: 'report/notes.md', action: 'added', seq: 1 },
    { repo_id: 'r3', project_id: 'work', path: 'notes.md', action: 'added', seq: 1 },
  ]
  rows.general_projects = [
    { id: 'gp1', name: 'Files', class_board_id: 'b1', archived_at: null, trashed_at: null },
    { id: 'gp2', name: 'Files', class_board_id: 'b2', archived_at: null, trashed_at: null },
    { id: 'work', name: 'Launch', class_board_id: null, archived_at: null, trashed_at: null },
  ]
  rows.project_boards = [
    { id: 'b1', project_id: 'cp', projects: project, group: { name: 'Team Lakan' }, student: null },
    { id: 'b2', project_id: 'cp', projects: project, group: null, student: { first_name: 'Ana', last_name: 'Cruz' } },
  ]
})

it('opens a group file on that group page, and names whose it is', async () => {
  const { files } = await searchWorkspace('notes')
  const byKey = new Map(files.map((f) => [f.key, f]))
  expect(byKey.get('main:gp1:report/notes.md')).toMatchObject({
    detail: 'File · Capstone · Team Lakan · report',
    to: '/class-projects/cp/boards/b1?tab=files&path=report',
  })
  expect(byKey.get('main:gp2:report/notes.md')).toMatchObject({
    detail: 'File · Capstone · Ana Cruz · report',
    to: '/class-projects/cp/boards/b2?tab=files&path=report',
  })
})

it('keeps a work project file on the work project', async () => {
  const { files } = await searchWorkspace('notes')
  expect(files.find((f) => f.key === 'main:work:notes.md')).toMatchObject({
    detail: 'File · Launch',
    to: '/projects/work?tab=files',
  })
})
