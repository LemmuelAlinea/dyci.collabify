// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { MyTaskBoard, MyTaskList } from './MyTasksViews'
import type { MyTaskItem } from './MyTasksViews'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const item = (key: string, over: Partial<MyTaskItem> = {}): MyTaskItem => ({
  key, kind: 'work', title: `Task ${key}`, where: 'Site', status: 'todo', due_at: null, share: 0, files: 0, comments: 0, minutes: 0, onOpen: vi.fn(), ...over,
})

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
async function render(node: React.ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(node))
}
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

const NOW = Date.UTC(2026, 10, 2)
const items = [
  item('norm'),
  item('urg', { priority: 'urgent', partOf: 'Part of Launch' }),
  item('low', { priority: 'low', partOf: 'Subtask' }),
  item('high', { priority: 'high', due_at: '2026-11-03T00:00:00Z' }),
]
it('board cards carry the priority badge and the Part of line', async () => {
  await render(<MyTaskBoard items={items} showDone={false} now={NOW} sort="" />)
  const card = (title: string) => [...container.querySelectorAll('article')].find((a) => a.textContent!.includes(title))!
  expect(card('Task urg').textContent).toContain('Urgent')
  expect(card('Task urg').textContent).toContain('Part of Launch')
  expect(card('Task low').textContent).toContain('Low')
  expect(card('Task low').textContent).toContain('Subtask')
  expect(card('Task norm').textContent).not.toMatch(/Urgent|High|Low|Part of|Subtask/)
})

it('the board puts urgent first when sorted by priority, else soonest due first', async () => {
  await render(<MyTaskBoard items={items} showDone={false} now={NOW} sort="priority" />)
  const order = () => [...container.querySelectorAll('article')].map((a) => a.querySelector('button')!.textContent)
  expect(order()).toEqual(['Task urg', 'Task high', 'Task norm', 'Task low'])
  await act(async () => root.render(<MyTaskBoard items={items} showDone={false} now={NOW} sort="" />))
  expect(order()[0]).toBe('Task high')
})

it('list rows carry the badge and Part of line, on the phone list and the table', async () => {
  await render(<MyTaskList items={items} now={NOW} sort="priority" />)
  const rows = [...container.querySelectorAll('tbody tr')].map((r) => r.textContent!)
  expect(rows[0]).toContain('Task urg')
  expect(rows[0]).toContain('Urgent')
  expect(rows[0]).toContain('Part of Launch')
  expect(rows[3]).toContain('Low')
  expect(rows[2]).not.toMatch(/Urgent|High|Low|Part of/)
  expect(container.querySelector('ul')!.textContent).toContain('Part of Launch')
})
