// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { PriorityBadge } from './PriorityBadge'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
async function render(priority: Parameters<typeof PriorityBadge>[0]['priority']) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<PriorityBadge priority={priority} />))
  return container
}
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

it.each([
  ['urgent', 'Urgent', 'danger'],
  ['high', 'High', 'warning'],
  ['low', 'Low', 'pending'],
] as const)('shows a %s badge in its status ramp', async (priority, label, ramp) => {
  const el = await render(priority)
  expect(el.textContent).toBe(label)
  expect(el.innerHTML).toContain(ramp)
})

it.each(['normal', undefined] as const)('shows nothing for %s', async (priority) => {
  const el = await render(priority)
  expect(el.innerHTML).toBe('')
})
