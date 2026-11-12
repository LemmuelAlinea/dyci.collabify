// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import type { BoardSummary, MemberProgress, ProjectSummary } from '../../lib/types'
import type { ProjectTasks } from '../tasks/useProjectTasks'
import { BoardHeader } from './BoardPage'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const board = (id: string) =>
  ({ id, project_id: 'p1', group_name: `Group ${id}`, student_name: null, member_count: 5 }) as BoardSummary
const boards = [board('a'), board('b'), board('c')]
const project = {
  id: 'p1', class_id: 'c1', class_initial: 'IT 301', title: 'Inventory system', audience: 'group',
} as ProjectSummary
const leader = {
  is_leader: true,
  group_pct: 40,
  profile: { id: 's1', first_name: 'Ana', middle_name: null, last_name: 'Cruz', avatar_url: null },
} as MemberProgress
const tasksFor = (active: string) =>
  ({ boards, active: boards.find((b) => b.id === active) ?? null, progress: [leader] }) as unknown as ProjectTasks

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
async function render(node: React.ReactNode, at = '/') {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<MemoryRouter initialEntries={[at]}>{node}</MemoryRouter>))
}
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

const step = (label: string) => container.querySelector(`[aria-label="${label}"]`)!

it('names the group, its leader and its size, under the breadcrumb', async () => {
  await render(<BoardHeader project={project} t={tasksFor('b')} boardId="b" />)
  expect(container.querySelector('h1')!.textContent).toBe('Group b')
  expect(container.textContent).toContain('Leader Ana Cruz · 5 members')
  const crumbs = [...container.querySelectorAll('nav a')].map((a) => a.getAttribute('href'))
  expect(crumbs).toEqual(['/classes/c1', '/class-projects/p1', '/class-projects/p1'])
})

it('steps to the neighbouring boards and stops at the ends', async () => {
  await render(<BoardHeader project={project} t={tasksFor('a')} boardId="a" />)
  expect(step('Previous group').tagName).toBe('BUTTON')
  expect((step('Previous group') as HTMLButtonElement).disabled).toBe(true)
  expect(step('Next group').getAttribute('href')).toBe('/class-projects/p1/boards/b')
})

it('keeps the tab when stepping', async () => {
  await render(<BoardHeader project={project} t={tasksFor('c')} boardId="c" />, '/x?tab=grade')
  expect(step('Previous group').getAttribute('href')).toBe('/class-projects/p1/boards/b?tab=grade')
  expect((step('Next group') as HTMLButtonElement).disabled).toBe(true)
})
