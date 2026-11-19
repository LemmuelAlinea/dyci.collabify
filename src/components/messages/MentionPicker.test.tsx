// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MentionPicker } from './MentionPicker'
import type { Mentionable } from '../../lib/api/mentions'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const items: Mentionable[] = [
  { kind: 't', id: 'a', title: 'Login page', project_id: 'p', project_title: 'Website' },
  { kind: 'p', id: 'p', title: 'Website', project_id: 'p', project_title: 'Website' },
]

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const draw = (props: Partial<React.ComponentProps<typeof MentionPicker>> = {}) =>
  act(() =>
    root.render(
      <MentionPicker items={items} active={0} loading={false} onPick={vi.fn()} onHover={vi.fn()} {...props} />,
    ),
  )
const options = () => [...host.querySelectorAll('[role="option"]')]

it('lists items with their project', () => {
  draw()
  expect(host.querySelector('[role="listbox"]')).not.toBeNull()
  expect(options()).toHaveLength(2)
  expect(options()[0].textContent).toContain('Login page')
  expect(options()[0].textContent).toContain('Website')
})

it('marks the active option', () => {
  draw({ active: 1 })
  expect(options()[0].getAttribute('aria-selected')).toBe('false')
  expect(options()[1].getAttribute('aria-selected')).toBe('true')
})

it('picks on click', () => {
  const onPick = vi.fn()
  draw({ onPick })
  act(() => (options()[0] as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(onPick).toHaveBeenCalledWith(items[0])
})

it('says when nothing matches', () => {
  draw({ items: [] })
  expect(host.textContent).toContain('No tasks or projects match')
})

it('shows a spinner while the first results load', () => {
  draw({ items: [], loading: true })
  expect(host.textContent).not.toContain('No tasks or projects match')
  expect(host.querySelector('[role="status"]')).not.toBeNull()
})
