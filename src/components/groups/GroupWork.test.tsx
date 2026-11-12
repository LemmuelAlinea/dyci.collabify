// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GroupWork } from './GroupWork'
import { listGroupBoards } from '../../lib/api/groupWork'
import type { TeachingViewRole } from '../../lib/types'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../hooks/useLive', () => ({ useLive: vi.fn() }))
vi.mock('../tasks/detail/TaskDetailModal', () => ({ TaskDetailModal: () => null }))
vi.mock('../../lib/api/groupWork', () => ({ listGroupBoards: vi.fn() }))
vi.mock('../../lib/api/tasks', () => ({ listTasks: vi.fn(async () => []) }))

const board = {
  id: 'b1', project_id: 'p1', project_title: 'Capstone', task_count: 0, done_count: 0,
  unclaimed_count: 0, done_pct: 0,
}

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null

beforeEach(() => {
  vi.mocked(listGroupBoards).mockResolvedValue([board] as never)
})

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = null
  root = null
  vi.clearAllMocks()
})

async function links(role: TeachingViewRole) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <MemoryRouter>
        <GroupWork groupId="g1" role={role} viewerId="v" />
      </MemoryRouter>,
    ),
  )
  await act(async () => {})
  await act(async () => {})
  const href = (text: string) =>
    [...host!.querySelectorAll('a')].find((a) => a.textContent?.includes(text))?.getAttribute('href')
  return { project: href('Project'), breakDown: href('Break the project down') }
}

it('sends a teacher to the group page in each project', async () => {
  expect(await links('professor')).toEqual({
    project: '/class-projects/p1/boards/b1',
    breakDown: '/class-projects/p1/boards/b1',
  })
})

it('keeps a student on the project, as before', async () => {
  expect(await links('student')).toEqual({
    project: '/class-projects/p1',
    breakDown: '/class-projects/p1?tab=work',
  })
})
