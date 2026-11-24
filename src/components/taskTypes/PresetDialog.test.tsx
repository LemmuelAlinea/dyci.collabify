// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PresetDialog } from './PresetDialog'
import { applyPreset, presetByKey } from '../../lib/taskTypes/presets'
import { defaultTypeSet } from '../../lib/taskTypes/typeSet'
import type { TaskTypeEntry } from '../../lib/taskTypes/typeSet'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

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

const general = applyPreset(defaultTypeSet('work'), presetByKey('general')!, 'work').set
const button = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

function setup(over: Partial<React.ComponentProps<typeof PresetDialog>> = {}) {
  const onApply = vi.fn(async (_set: TaskTypeEntry[], _key: string) => {})
  const loadCounts = vi.fn(async () => new Map<string, number>())
  act(() => root.render(
    <PresetDialog open family="work" current={general} currentPreset={null} loadCounts={loadCounts}
      onApply={onApply} onClose={() => {}} {...over} />,
  ))
  return { onApply, loadCounts }
}

function choose(key: string) {
  const select = document.querySelector('select') as HTMLSelectElement
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, key)
  act(() => { select.dispatchEvent(new Event('change', { bubbles: true })) })
}

it('opens on General Project with its types', () => {
  setup()
  expect(document.body.textContent).toContain('Explore task type presets')
  expect((document.querySelector('select') as HTMLSelectElement).value).toBe('general')
  expect(document.body.textContent).toContain('7 types')
  expect(document.body.textContent).toContain('#DC2626')
})

it('opens on the project\'s own preset', () => {
  setup({ currentPreset: 'hr' })
  expect((document.querySelector('select') as HTMLSelectElement).value).toBe('hr')
})

it('shows another preset with its bug type labeled', () => {
  setup()
  choose('construction')
  expect(document.body.textContent).toContain('10 types')
  const row = [...document.querySelectorAll('[data-preset-row]')].find((r) => r.textContent?.includes('Deficiency'))!
  expect(row.textContent).toContain("QA's bugs")
})

it('shows no bug label on a class project', () => {
  setup({ family: 'class', current: defaultTypeSet('class') })
  choose('construction')
  const row = [...document.querySelectorAll('[data-preset-row]')].find((r) => r.textContent?.includes('Deficiency'))!
  expect(row.textContent).not.toContain("QA's bugs")
})

it('applies straight away when no task loses its type', async () => {
  const { onApply } = setup()
  choose('software')
  await act(async () => button('Apply preset').click())
  await flush()
  expect(onApply).toHaveBeenCalledWith(applyPreset(general, presetByKey('software')!, 'work').set, 'software')
})

it('asks first when tasks would lose their type, then applies', async () => {
  const { onApply } = setup({ loadCounts: vi.fn(async () => new Map([['Deliverable', 4], ['Planning', 2]])) })
  choose('software')
  await act(async () => button('Apply preset').click())
  await flush()
  expect(onApply).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('Apply System and Software Development?')
  expect(document.body.textContent).toContain('These types leave the list: Deliverable (4 tasks), Planning (2 tasks). Their tasks keep the name, shown in gray.')
  await act(async () => button('Go back').click())
  expect(document.body.textContent).toContain('Explore task type presets')
  await act(async () => button('Apply preset').click())
  await flush()
  await act(async () => button('Apply preset').click())
  await flush()
  expect(onApply).toHaveBeenCalledTimes(1)
})

it('warns when an old name becomes the bug type', async () => {
  const withIssue: TaskTypeEntry[] = [...defaultTypeSet('work'), { slot: null, name: 'Issue', description: '', color: '#0891b2', icon: 'tag' }]
  setup({ current: withIssue, loadCounts: vi.fn(async () => new Map([['Issue', 3]])) })
  choose('general')
  await act(async () => button('Apply preset').click())
  await flush()
  expect(document.body.textContent).toContain("Issue tasks from the old list stay gray. They aren't QA's bugs.")
})
