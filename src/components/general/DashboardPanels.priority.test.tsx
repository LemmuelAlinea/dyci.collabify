// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { MyTasksPanel } from './DashboardPanels'
import type { GeneralTask } from '../../lib/general/types'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const task = (id: string, over: Partial<GeneralTask> = {}) =>
  ({ id, project_id: 'p', title: `Task ${id}`, status: 'todo', due_at: null, priority: 'normal', parent_id: null, ...over }) as GeneralTask

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

it('shows the priority badge and the Part of line on a task row', async () => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const tasks = [task('a', { priority: 'urgent', parent_id: 'x' }), task('b', { parent_id: 'y' }), task('c')]
  const partOf = (t: GeneralTask) => (t.parent_id === 'x' ? 'Part of Launch' : t.parent_id ? 'Subtask' : null)
  await act(async () =>
    root.render(
      <MemoryRouter>
        <MyTasksPanel tasks={tasks} projectName={() => 'Site'} now={0} partOf={partOf} />
      </MemoryRouter>,
    ),
  )
  const rows = [...container.querySelectorAll('li')].map((li) => li.textContent!)
  expect(rows[0]).toContain('Urgent')
  expect(rows[0]).toContain('Part of Launch')
  expect(rows[1]).toContain('Subtask')
  expect(rows[1]).not.toContain('Urgent')
  expect(rows[2]).not.toMatch(/Urgent|High|Low|Part of|Subtask/)
})
