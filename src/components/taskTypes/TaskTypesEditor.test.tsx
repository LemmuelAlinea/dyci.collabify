// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TaskTypesEditor } from './TaskTypesEditor'
import type { TaskTypeDraft, TaskTypeEntry } from '../../lib/taskTypes/typeSet'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../ui/Toast', () => {
  const show = vi.fn()
  return { useToast: () => ({ show }) }
})

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

const set: TaskTypeEntry[] = [
  { slot: 'default', name: 'Task', description: 'Standard actionable work.', color: '#2563eb', icon: 'square-check' },
  { slot: 'bug', name: 'Bug', description: 'Errors, defects, and issues requiring fixes.', color: '#dc2626', icon: 'bug' },
  { slot: null, name: 'Epic', description: 'Large bodies of work', color: '#db2777', icon: 'zap' },
]

function setup(over: Partial<React.ComponentProps<typeof TaskTypesEditor>> = {}) {
  const save = vi.fn(async (_types: TaskTypeDraft[], _shown: string, _preset?: string | null) => {})
  const reload = vi.fn(async () => {})
  const loadCounts = vi.fn(async () => new Map([['Epic', 3]]))
  act(() => root.render(
    <TaskTypesEditor
      family="work" set={set} shown="s1" preset={null} editable readOnlyNote="Only the project manager changes task types."
      save={save} reload={reload} loadCounts={loadCounts} {...over}
    />,
  ))
  return { save, reload, loadCounts }
}

const byLabel = (label: string) => document.querySelector(`[aria-label="${label}"]`) as HTMLElement
const button = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement
function type(el: Element, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
  act(() => { el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const flush = () => act(async () => { await Promise.resolve() })

it('shows the heading, the rows in order and the slot labels', () => {
  setup({ preset: 'software' })
  expect(host.textContent).toContain('Task types')
  expect(host.textContent).toContain('Manage how work is categorized within this project.')
  expect(host.textContent).toContain('Based on the System and Software Development preset.')
  const names = [...host.querySelectorAll('[data-type-row] [data-type-name]')].map((n) => n.textContent)
  expect(names).toEqual(['Task', 'Bug', 'Epic'])
  expect(host.textContent).toContain('Default')
  expect(host.textContent).toContain("QA's bugs")
})

it('renames a type and saves the whole set with the old name', async () => {
  const { save } = setup()
  act(() => byLabel('Edit Epic').click())
  expect(host.textContent).toContain('Edit task type')
  type(byLabel('Name'), 'Initiative')
  await act(async () => button('Save type').click())
  expect(save).toHaveBeenCalledTimes(1)
  const [types, shown, preset] = save.mock.calls[0]
  expect(shown).toBe('s1')
  expect(preset).toBeUndefined()
  expect(types.map((t) => t.name)).toEqual(['Task', 'Bug', 'Initiative'])
  expect(types[2]).toMatchObject({ was: 'Epic', color: '#db2777', icon: 'zap' })
  expect(types[0]).not.toHaveProperty('was')
})

it('adds a type with the first unused color and the tag icon', async () => {
  const { save } = setup()
  act(() => button('+ Add type').click())
  const preview = host.querySelector('[data-type-preview] [data-type-chip]') as HTMLElement
  expect(preview).not.toBeNull()
  type(byLabel('Name'), 'Feature')
  await act(async () => button('Save type').click())
  const added = save.mock.calls[0][0][3]
  expect(added).toEqual({ slot: null, name: 'Feature', description: '', color: '#0891b2', icon: 'tag' })
})

it('picks a swatch, an icon and a free hex', async () => {
  const { save } = setup()
  act(() => byLabel('Edit Epic').click())
  act(() => byLabel('Teal').click())
  act(() => byLabel('Rocket').click())
  await act(async () => button('Save type').click())
  expect(save.mock.calls[0][0][2]).toMatchObject({ color: '#0d9488', icon: 'rocket' })
  act(() => byLabel('Edit Epic').click())
  type(byLabel('Hex color'), '#FFFF00')
  await act(async () => button('Save type').click())
  expect(save.mock.calls[1][0][2]).toMatchObject({ color: '#ffff00' })
})

it('refuses an invalid name before saving', async () => {
  const { save } = setup()
  act(() => byLabel('Edit Epic').click())
  type(byLabel('Name'), 'task')
  await act(async () => button('Save type').click())
  expect(save).not.toHaveBeenCalled()
  expect(host.textContent).toContain('Use distinct names of 1 to 40 characters. Task and Bug stay reserved for the built-in types.')
})

it('confirms a delete with the task count', async () => {
  const { save } = setup()
  act(() => byLabel('Edit Epic').click())
  await act(async () => button('Delete type').click())
  await flush()
  expect(document.body.textContent).toContain('Delete Epic?')
  expect(document.body.textContent).toContain('3 tasks keep the name, shown in gray.')
  await act(async () => button('Delete').click())
  expect(save.mock.calls[0][0].map((t) => t.name)).toEqual(['Task', 'Bug'])
})

it('offers no delete on a built-in slot', () => {
  setup()
  act(() => byLabel('Edit Bug').click())
  expect(button('Delete type')).toBeUndefined()
})

it('moves a row with the keyboard and saves the order', async () => {
  const { save } = setup()
  const handle = byLabel('Move Bug')
  await act(async () => { handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
  expect(save.mock.calls[0][0].map((t) => t.name)).toEqual(['Task', 'Epic', 'Bug'])
  expect(host.querySelector('[aria-live="polite"]')?.textContent).toBe('Bug moved to position 3.')
})

it('is read-only for everyone else', () => {
  setup({ editable: false })
  expect(host.querySelector('[aria-label^="Edit "]')).toBeNull()
  expect(host.querySelector('[aria-label^="Move "]')).toBeNull()
  expect(button('+ Add type')).toBeUndefined()
  expect(host.textContent).toContain('Only the project manager changes task types.')
})

it('stops adding at 20 custom types', () => {
  const many = Array.from({ length: 20 }, (_, i): TaskTypeEntry => ({ slot: null, name: `Type ${i}`, description: '', color: '#0891b2', icon: 'tag' }))
  setup({ set: [set[0], set[1], ...many] })
  const add = button('+ Add type')
  expect(add.disabled).toBe(true)
  expect(add.title).toBe('Keep at most 20 custom task types.')
})

it('offers Reload after a stale save', async () => {
  const { reload } = setup({
    save: vi.fn(async () => { throw new Error('Someone changed these task types. Reload to see them.') }),
  })
  act(() => byLabel('Edit Epic').click())
  type(byLabel('Name'), 'Initiative')
  await act(async () => button('Save type').click())
  expect(host.textContent).toContain('Someone changed these task types. Reload to see them.')
  await act(async () => button('Reload').click())
  expect(reload).toHaveBeenCalled()
})

it("keeps focus on the moved row's handle", async () => {
  let done: () => void = () => {}
  setup({ save: vi.fn(() => new Promise<void>((resolve) => { done = resolve })) })
  const handle = byLabel('Move Bug')
  act(() => handle.focus())
  await act(async () => { handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
  expect(byLabel('Move Bug')).not.toBeNull()
  await act(async () => { done() })
  expect(document.activeElement).toBe(byLabel('Move Bug'))
  const reordered = [set[0], set[2], set[1]]
  act(() => root.render(
    <TaskTypesEditor family="work" set={reordered} shown="s2" preset={null} editable readOnlyNote=""
      save={vi.fn(async () => {})} reload={vi.fn(async () => {})} loadCounts={vi.fn(async () => new Map())} />,
  ))
  expect(document.activeElement).toBe(byLabel('Move Bug'))
})
