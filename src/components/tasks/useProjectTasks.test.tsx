// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { useProjectTasks } from './useProjectTasks'
import type { ProjectTasks } from './useProjectTasks'
import { listProjectTaskRows } from '../../lib/api/tasks'
import type { ProjectSummary } from '../../lib/types'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../hooks/useLive', () => ({ useLive: vi.fn() }))
// One object for every render, as the real hook's state is: a fresh `tasks`
// array each render would re-run the progress effect forever.
const board = vi.hoisted(() => ({ tasks: [], members: [], loading: false, reload: async () => {} }))
vi.mock('../../hooks/useTaskBoard', () => ({ useTaskBoard: () => board }))
vi.mock('../../lib/api/milestones', () => ({ listMilestones: async () => [] }))
vi.mock('../../lib/api/sprints', () => ({ listSprints: async () => [] }))
vi.mock('../../lib/api/tasks', () => ({
  listProjectTaskRows: vi.fn(),
  groupByOrigin: () => [],
  listMemberProgress: async () => [],
}))

const project = { id: 'p1', audience: 'group', locked_at: null } as unknown as ProjectSummary

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = null
  root = null
  vi.clearAllMocks()
})

async function load(boardId: string) {
  let seen: ProjectTasks | null = null
  function Probe() {
    seen = useProjectTasks({ project, role: 'professor', boardId })
    return null
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <MemoryRouter>
        <Probe />
      </MemoryRouter>,
    ),
  )
  await act(async () => {})
  return seen! as ProjectTasks
}

it('reports the load error, not a missing group, when the boards fail to load', async () => {
  vi.mocked(listProjectTaskRows).mockRejectedValue(new Error('Network down'))
  const t = await load('b1')
  expect(t.error).toBeTruthy()
  expect(t.boardMissing).toBe(false)
})

it('still says the group is missing when the boards load without it', async () => {
  vi.mocked(listProjectTaskRows).mockResolvedValue({ boards: [{ id: 'b2' }], rows: [] } as never)
  const t = await load('b1')
  expect(t.error).toBeNull()
  expect(t.boardMissing).toBe(true)
})
