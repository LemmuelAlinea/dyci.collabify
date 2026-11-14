// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ComingUpPanel, MyTasksPanel, RecentPanel, WaitingPanel } from './DashboardPanels'
import type { ComingDay } from '../../lib/general/dashboard'
import type { GeneralProjectSummary, GeneralRepoChange, GeneralTask } from '../../lib/general/types'

vi.mock('../../hooks/useProjectLooks', () => ({ useProjectLooks: () => ({}) }))

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const show = (node: React.ReactNode) =>
  act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>))
const panel = () => host.querySelector('[data-tone]')
const name = () => 'Barangay Website'

it('shows the caught-up panel in Waiting on you when nothing waits', async () => {
  await show(<WaitingPanel reviews={[]} requests={[]} projectName={name} flat />)
  expect(panel()?.textContent).toContain("You're all caught up")
  expect(panel()?.textContent).toContain('Nothing is waiting on you.')
  expect(panel()?.querySelector('svg')).not.toBeNull()
})

it('shows the no-tasks panel in My tasks with the line the page passes', async () => {
  await show(
    <MyTasksPanel tasks={[]} projectName={name} now={0} empty="Tasks assigned to you show here." flat />,
  )
  expect(panel()?.textContent).toContain('No open tasks')
  expect(panel()?.textContent).toContain('Tasks assigned to you show here.')
})

it('says "in this space" in My tasks by default', async () => {
  await show(<MyTasksPanel tasks={[]} projectName={name} now={0} />)
  expect(panel()?.textContent).toContain('Tasks assigned to you in this space show here.')
})

it('shows the clear-calendar panel in Coming up when nothing is due', async () => {
  await show(<ComingUpPanel days={[]} projectName={name} now={0} flat />)
  expect(panel()?.textContent).toContain('Your calendar is clear')
  expect(panel()?.textContent).toContain('Nothing is due in the next two weeks.')
})

it('shows the no-projects panel in Jump back in when there are none', async () => {
  await show(<RecentPanel projects={[]} flat />)
  expect(panel()?.textContent).toContain('No projects yet')
  expect(panel()?.textContent).toContain('Projects you open show here.')
})

it('keeps Waiting on you as rows when a review waits', async () => {
  const reviews = [
    { id: 'r1', project_id: 'p1', title: 'New header', files: [{}, {}] },
  ] as unknown as GeneralRepoChange[]
  await show(<WaitingPanel reviews={reviews} requests={[]} projectName={name} flat />)
  expect(panel()).toBeNull()
  expect(host.querySelectorAll('li')).toHaveLength(1)
  expect(host.textContent).toContain('New header')
  expect(host.textContent).toContain('2 files')
})

it('keeps My tasks as rows when a task is assigned', async () => {
  const tasks = [
    { id: 't1', project_id: 'p1', title: 'Set up foundations', status: 'todo', due_at: null, priority: 'normal', parent_id: null },
  ] as unknown as GeneralTask[]
  await show(<MyTasksPanel tasks={tasks} projectName={name} now={0} flat />)
  expect(panel()).toBeNull()
  expect(host.querySelectorAll('li')).toHaveLength(1)
  expect(host.textContent).toContain('Set up foundations')
})

it('keeps Coming up as a day heading and rows when something is due', async () => {
  const at = new Date(2026, 10, 25, 23, 59).getTime()
  const days: ComingDay[] = [
    { day: '2026-11-25', at, items: [{ kind: 'task', id: 't1', projectId: 'p1', title: 'Estimate costs', at }] },
  ]
  await show(<ComingUpPanel days={days} projectName={name} now={new Date(2026, 10, 15).getTime()} flat />)
  expect(panel()).toBeNull()
  expect(host.querySelector('.eyebrow')).not.toBeNull()
  expect(host.textContent).toContain('Estimate costs')
  expect(host.textContent).toContain('Barangay Website')
})

it('keeps Jump back in as project rows with progress', async () => {
  const projects = [
    { id: 'p1', name: 'Barangay Website', progress_pct: 23.4, done_count: 15, task_count: 64 },
  ] as unknown as GeneralProjectSummary[]
  await show(<RecentPanel projects={projects} flat />)
  expect(panel()).toBeNull()
  expect(host.querySelectorAll('li')).toHaveLength(1)
  expect(host.textContent).toContain('23.4%')
  expect(host.textContent).toContain('15/64 tasks done')
})
