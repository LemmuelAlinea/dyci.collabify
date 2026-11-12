// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import type { BoardSummary, ProjectSummary } from '../../lib/types'
import type { ProjectTasks } from '../tasks/useProjectTasks'
import { BoardPage } from './BoardPage'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

// Each dialog marks itself, so the test can count them.
vi.mock('../tasks/detail/TaskDetailModal', () => ({
  TaskDetailModal: ({ taskId }: { taskId: string | null }) =>
    taskId ? <div data-dialog="page" /> : null,
}))
// The real board opens its own dialog from `?task=`.
vi.mock('../tasks/TaskBoard', () => ({
  TaskBoard: () => {
    const [params] = useSearchParams()
    return params.get('task') ? <div data-dialog="board" /> : null
  },
}))
vi.mock('../tasks/BoardProgress', () => ({ BoardProgress: () => null }))
vi.mock('../tasks/MemberProgress', () => ({ MemberProgress: () => null }))
vi.mock('../tasks/TaskList', () => ({ TaskList: () => null }))
vi.mock('../tasks/TaskViewSwitch', () => ({ TaskViewSwitch: () => null, TaskFilterBar: () => null }))
vi.mock('../scoring/ScoreCard', () => ({ ScoreCard: () => null }))
vi.mock('../scoring/useProjectScores', () => ({ useProjectScores: () => ({}) }))
vi.mock('../peer/PeerRoundsPanel', () => ({ PeerRoundsPanel: () => null }))
vi.mock('../../hooks/useLive', () => ({ useLive: () => {} }))
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: () => {} }) }))
vi.mock('../../lib/api/results', () => ({
  boardResult: async () => null,
  recordResult: async () => {},
}))

const board = (id: string) =>
  ({
    id, project_id: 'p1', group_name: `Group ${id}`, student_name: null, member_count: 4,
    submitted_at: '2026-11-10T00:00:00Z', done_pct: 50, late_count: 0, task_count: 3,
  }) as BoardSummary
const project = {
  id: 'p1', class_id: 'c1', class_initial: 'IT 301', title: 'Inventory', audience: 'group', stages: null,
} as unknown as ProjectSummary
const tasks = (active: BoardSummary, over: Partial<ProjectTasks> = {}) =>
  ({
    boards: [active], active, error: null, progress: [], tasks: [], boardTasks: [], members: [],
    scope: [], shown: [], rows: [], sprints: [], milestones: [], filters: {}, view: 'board',
    boardLoading: false, openTask: null, weightByBoard: new Map(),
    showTask: () => {}, setFilters: () => {}, setView: () => {}, setSection: () => {},
    setSprintScope: () => {}, refresh: async () => {}, ownerFor: () => '',
    ...over,
  }) as unknown as ProjectTasks

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
async function render(node: React.ReactNode, at: string) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<MemoryRouter initialEntries={[at]}>{node}</MemoryRouter>))
}
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

const dialogs = () => [...document.querySelectorAll('[data-dialog]')].map((d) => d.getAttribute('data-dialog'))

it('opens one task dialog on the Overview board, the board’s own', async () => {
  const a = board('a')
  await render(<BoardPage project={project} t={tasks(a, { openTask: 't1' })} />, '/x?task=t1')
  expect(dialogs()).toEqual(['board'])
})

it('opens the page’s dialog on another layout or tab', async () => {
  const a = board('a')
  await render(<BoardPage project={project} t={tasks(a, { openTask: 't1', view: 'list' })} />, '/x?task=t1&layout=list')
  expect(dialogs()).toEqual(['page'])
  await act(async () => root.unmount())
  container.remove()

  await render(<BoardPage project={project} t={tasks(a, { openTask: 't1' })} />, '/x?tab=grade&task=t1')
  expect(dialogs()).toEqual(['page'])
})

it('drops a half-written send-back note when the board changes', async () => {
  const a = board('a')
  const b = board('b')
  await render(<BoardPage project={project} t={tasks(a)} />, '/x?tab=grade')

  const returnIt = [...container.querySelectorAll('button')].find((x) => x.textContent?.includes('Return it'))!
  await act(async () => returnIt.click())
  const note = document.querySelector('textarea')!
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    set.call(note, 'Fix the ERD')
    note.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(document.querySelector('textarea')!.value).toBe('Fix the ERD')

  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/x?tab=grade']}>
        <BoardPage project={project} t={tasks(b)} />
      </MemoryRouter>,
    ),
  )
  expect(document.querySelector('textarea')?.value ?? '').toBe('')
})
