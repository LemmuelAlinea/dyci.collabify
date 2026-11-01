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
  ['urgent', 'Urgent', ['bg-danger-500/15', 'text-danger-700', 'dark:text-danger-300']],
  ['high', 'High', ['bg-warning-400/18', 'text-warning-700', 'dark:text-warning-300']],
  ['low', 'Low', ['bg-pending-soft', 'text-pending-ink']],
] as const)('shows a %s badge in its status ramp', async (priority, label, tokens) => {
  const el = await render(priority)
  expect(el.textContent).toBe(label)
  const classes = el.firstElementChild!.className.split(' ')
  for (const token of tokens) expect(classes).toContain(token)
})

it.each(['normal', undefined] as const)('shows nothing for %s', async (priority) => {
  const el = await render(priority)
  expect(el.innerHTML).toBe('')
})
