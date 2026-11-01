// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TasksTab } from './TasksTab'
import type { GeneralProjectState } from './useGeneralProject'

vi.mock('../../lib/api/general', () => ({ createTask: vi.fn(), updateTask: vi.fn() }))
vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('./TaskDialog', () => ({ TaskDialog: () => null }))
vi.mock('./TaskRoutingPanel', () => ({ TaskRoutingPanel: () => null }))
vi.mock('./TasksFromNotes', () => ({ TasksFromNotes: () => null }))

const base = { project_id: 'p', team_id: null, routing_state: 'released', assignee_ids: [], status: 'todo', stage: 0, description: '', sprint_id: null, archived_at: null, file_count: 0, comment_count: 0, logged_minutes: 0, due_at: null, kind: 'task', priority: 'normal', parent_id: null }
const task = (id: string, over: Record<string, unknown> = {}) => ({ ...base, id, title: `Task ${id}`, ...over })

function stateWith(tasks: unknown[], over: Record<string, unknown> = {}, classBoard: string | null = null) {
  return {
    project: { id: 'p', class_board_id: classBoard, stages: ['Todo', 'Doing', 'Done'] },
    myRole: 'pm', viewerId: 'me', readOnly: false, tasks, dependencies: [],
    teams: [], teamMembers: [], members: [], sprints: [], milestones: [],
    can: () => false, qaBlocks: () => false, leadsUser: () => false, nameOf: (id: string) => id,
    ...over,
  } as unknown as GeneralProjectState
}

const onOpenTask = vi.fn()
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
async function render(state: GeneralProjectState, layout: 'board' | 'list' = 'board') {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<TasksTab state={state} layout={layout} onLayout={vi.fn()} onViewBoard={vi.fn()} scope="all" onScope={vi.fn()} onOpenTask={onOpenTask} />))
}
beforeEach(() => {
  localStorage.clear()
  onOpenTask.mockClear()
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

const titles = () => [...container.querySelectorAll('article h4')].map((h) => h.textContent)
const click = (el: Element | null | undefined) => act(async () => (el as HTMLElement).click())
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label || b.getAttribute('aria-label')?.startsWith(label))
const chip = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Priority"] button')].find((b) => b.textContent === label)
const cardOf = (id: string) => container.querySelector(`[aria-label="Open Task ${id}"]`)!.closest('article')!

it('shows a badge for urgent, high and low and none for normal', async () => {
  await render(stateWith([task('u', { priority: 'urgent' }), task('h', { priority: 'high' }), task('l', { priority: 'low' }), task('n')]))
  expect(cardOf('u').textContent).toContain('Urgent')
  expect(cardOf('h').textContent).toContain('High')
  expect(cardOf('l').textContent).toContain('Low')
  expect(cardOf('n').textContent).not.toMatch(/Urgent|High|Low/)
})

it('shows the subtask count on a parent card', async () => {
  const tasks = [task('parent'), task('a', { parent_id: 'parent', status: 'done' }), task('b', { parent_id: 'parent', status: 'done' }), task('c', { parent_id: 'parent' })]
  await render(stateWith(tasks))
  expect(cardOf('parent').textContent).toContain('2/3')
  expect(cardOf('a').textContent).not.toContain('/')
})

it('names the parent on a subtask card, and falls back to Subtask when it is not shown', async () => {
  await render(stateWith([task('parent'), task('a', { parent_id: 'parent' }), task('b', { parent_id: 'gone' })]))
  expect(cardOf('a').textContent).toContain('Part of Task parent')
  expect(cardOf('b').textContent).toContain('Subtask')
  expect(cardOf('b').textContent).not.toContain('Part of')
})

it('marks a task that waits on an open blocker, with a tooltip naming it', async () => {
  const tasks = [task('x'), task('open', { title: 'Design the form' }), task('finished', { status: 'done' }), task('free')]
  const dependencies = [{ task_id: 'x', depends_on_id: 'open' }, { task_id: 'x', depends_on_id: 'finished' }]
  await render(stateWith(tasks, { dependencies }))
  const marker = cardOf('x').querySelector('[title^="Waiting for"]')!
  expect(marker.textContent).toContain('Waiting')
  expect(marker.getAttribute('title')).toBe('Waiting for Design the form')
  expect(cardOf('free').querySelector('[title^="Waiting for"]')).toBeNull()
})

it('makes the waiting marker reachable, named for every blocker, and a way into the task', async () => {
  const tasks = [task('x'), task('one', { title: 'Design login' }), task('two', { title: 'API spec' })]
  const dependencies = [{ task_id: 'x', depends_on_id: 'one' }, { task_id: 'x', depends_on_id: 'two' }]
  await render(stateWith(tasks, { dependencies }))
  const marker = cardOf('x').querySelector<HTMLElement>('[title^="Waiting for"]')!
  // Accessible by name and by keyboard, not only by a hover tooltip.
  expect(marker.getAttribute('aria-label')).toBe('Waiting for: Design login, API spec')
  expect(marker.tagName).toBe('BUTTON')
  expect(marker.tabIndex).toBe(0)
  // Positioned above the card's full-card button (absolute, z-0), or it never receives the pointer.
  const overlay = cardOf('x').querySelector('[aria-label="Open Task x"]')!
  expect(overlay.className).toContain('absolute')
  expect(overlay.className).toContain('z-0')
  expect(marker.className.split(' ')).toEqual(expect.arrayContaining(['relative', 'z-10']))
  await click(marker)
  expect(onOpenTask).toHaveBeenCalledExactlyOnceWith('x')
})

it('shows the same marks in the list layout', async () => {
  const tasks = [task('parent', { priority: 'urgent' }), task('a', { parent_id: 'parent', status: 'done' }), task('b', { parent_id: 'parent' })]
  await render(stateWith(tasks, { dependencies: [{ task_id: 'b', depends_on_id: 'parent' }] }), 'list')
  const rows = [...container.querySelectorAll('tbody tr')].map((r) => r.textContent!)
  expect(rows[0]).toContain('Urgent')
  expect(rows[0]).toContain('1/2')
  expect(rows[2]).toContain('Part of Task parent')
  expect(rows[2]).toContain('Waiting')
})

it('filters by priority and sorts urgent first, and remembers the choice', async () => {
  const tasks = [task('low', { priority: 'low' }), task('norm'), task('urg', { priority: 'urgent' }), task('hi', { priority: 'high' })]
  await render(stateWith(tasks))
  expect(titles()).toEqual(['Task low', 'Task norm', 'Task urg', 'Task hi'])

  await click(button('Filter tasks'))
  await click(chip('Urgent'))
  await click(chip('Low'))
  expect(titles()).toEqual(['Task low', 'Task urg'])

  const sort = container.querySelector<HTMLSelectElement>('select[aria-label="Sort"]')!
  await act(async () => { sort.value = 'priority'; sort.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(titles()).toEqual(['Task urg', 'Task low'])
  expect(JSON.parse(localStorage.getItem('collabify:task-priority:p')!)).toEqual({ priorities: ['urgent', 'low'], sort: 'priority' })
})

it('starts from the saved choice', async () => {
  localStorage.setItem('collabify:task-priority:p', JSON.stringify({ priorities: ['high'], sort: '' }))
  await render(stateWith([task('norm'), task('hi', { priority: 'high' })]))
  expect(titles()).toEqual(['Task hi'])
})

it('leaves a class board alone: no badges, marks or priority filter', async () => {
  const tasks = [{ ...task('c'), priority: undefined, parent_id: undefined }]
  await render(stateWith(tasks, {}, 'board-1'))
  expect(cardOf('c').textContent).not.toMatch(/Urgent|High|Low|Waiting|Part of|Subtask/)
  await click(button('Filter tasks'))
  expect(container.querySelector('[aria-label="Priority"]')).toBeNull()
})
