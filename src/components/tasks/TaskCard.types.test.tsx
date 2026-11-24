// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { TaskCard } from './TaskCard'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const typeSet = [
  { slot: 'default' as const, name: 'Research Task', description: '', color: '#2563eb', icon: 'search' as const },
  { slot: null, name: 'Review', description: 'Peer review', color: '#0d9488', icon: 'clipboard-check' as const },
]

it("shows a class task's type, the default included", async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const task = (over: Record<string, unknown>) => ({
    id: 't', title: 'Draft', details: '', status: 'todo', stage: 0, weight: 1, due_at: null, assignees: [], priority: 'normal', parent_id: null, task_type: 'Task', ...over,
  })
  const card = (over: Record<string, unknown>) => {
    const props = {
      task: task(over), members: [], progress: [], viewerId: 'u', role: 'student', canWork: false, typeSet,
      onStatus: () => {}, onEdit: () => {}, onDelete: () => {}, onArchive: () => {}, onClaim: () => {}, onRelease: () => {}, onOpen: () => {},
    } as unknown as React.ComponentProps<typeof TaskCard>
    return <TaskCard {...props} />
  }
  await act(async () => root.render(card({})))
  expect(host.querySelector('[data-type-chip]')?.textContent).toBe('Research Task')
  await act(async () => root.render(card({ task_type: 'Review' })))
  expect(host.querySelector('[data-type-chip]')?.textContent).toBe('Review')
  await act(async () => root.unmount())
  host.remove()
})
