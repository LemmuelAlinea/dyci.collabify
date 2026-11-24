// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TypePicker } from './TypePicker'
import { typeOptions } from '../../lib/taskTypes/typeSet'
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
})

const set: TaskTypeEntry[] = [
  { slot: 'default', name: 'Task', description: 'Standard actionable work.', color: '#2563eb', icon: 'square-check' },
  { slot: 'bug', name: 'Bug', description: 'Errors, defects, and issues requiring fixes.', color: '#dc2626', icon: 'bug' },
  { slot: null, name: 'Epic', description: 'Large bodies of work', color: '#db2777', icon: 'zap' },
]
const options = typeOptions(set, { family: 'work', role: 'pm' })

function key(target: Element, k: string) {
  act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) })
}

it('shows the chosen type and opens a list with descriptions', () => {
  act(() => root.render(<TypePicker label="Type" value="task" options={options} onChange={() => {}} />))
  const button = host.querySelector('button') as HTMLButtonElement
  expect(button.textContent).toContain('Task')
  expect(button.getAttribute('aria-haspopup')).toBe('listbox')
  expect(host.querySelector('[role="listbox"]')).toBeNull()
  act(() => button.click())
  const rows = host.querySelectorAll('[role="option"]')
  expect([...rows].map((r) => r.querySelector('[data-type-name]')?.textContent)).toEqual(['Task', 'Bug', 'Epic'])
  expect(rows[2].textContent).toContain('Large bodies of work')
  expect(rows[0].getAttribute('aria-selected')).toBe('true')
})

it('picks with the arrows and Enter', () => {
  const onChange = vi.fn()
  act(() => root.render(<TypePicker label="Type" value="task" options={options} onChange={onChange} />))
  act(() => (host.querySelector('button') as HTMLButtonElement).click())
  const list = host.querySelector('[role="listbox"]') as HTMLElement
  key(list, 'ArrowDown')
  key(list, 'ArrowDown')
  key(list, 'Enter')
  expect(onChange).toHaveBeenCalledWith('Epic')
  expect(host.querySelector('[role="listbox"]')).toBeNull()
})

it('closes on Escape without picking', () => {
  const onChange = vi.fn()
  act(() => root.render(<TypePicker label="Type" value="task" options={options} onChange={onChange} />))
  act(() => (host.querySelector('button') as HTMLButtonElement).click())
  key(host.querySelector('[role="listbox"]') as HTMLElement, 'Escape')
  expect(host.querySelector('[role="listbox"]')).toBeNull()
  expect(onChange).not.toHaveBeenCalled()
})

it('picks with a click', () => {
  const onChange = vi.fn()
  act(() => root.render(<TypePicker label="Type" value="task" options={options} onChange={onChange} />))
  act(() => (host.querySelector('button') as HTMLButtonElement).click())
  act(() => (host.querySelectorAll('[role="option"]')[1] as HTMLElement).click())
  expect(onChange).toHaveBeenCalledWith('bug')
})

it('stays shut when disabled', () => {
  act(() => root.render(<TypePicker label="Type" value="task" options={options} onChange={() => {}} disabled />))
  const button = host.querySelector('button') as HTMLButtonElement
  expect(button.disabled).toBe(true)
  act(() => button.click())
  expect(host.querySelector('[role="listbox"]')).toBeNull()
})
