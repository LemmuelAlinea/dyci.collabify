// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ActiveStatusSetting } from './ActiveStatusSetting'
import { getActiveStatus, setActiveStatus } from '../../lib/api/presence'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../lib/api/presence', () => ({
  getActiveStatus: vi.fn(async () => true),
  setActiveStatus: vi.fn(async () => {}),
}))

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  vi.mocked(getActiveStatus).mockResolvedValue(true)
  vi.mocked(setActiveStatus).mockReset().mockResolvedValue(undefined)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const draw = async () => {
  await act(async () => root.render(<ActiveStatusSetting />))
}
const sw = () => host.querySelector<HTMLButtonElement>('[role="switch"]')!

it('shows the saved value once loaded', async () => {
  vi.mocked(getActiveStatus).mockResolvedValue(false)
  await draw()
  expect(sw().getAttribute('aria-checked')).toBe('false')
  expect(sw().disabled).toBe(false)
  expect(host.textContent).toContain("Show when you're active")
})

it('saves a change', async () => {
  await draw()
  await act(async () => sw().click())
  expect(setActiveStatus).toHaveBeenCalledWith(false)
  expect(sw().getAttribute('aria-checked')).toBe('false')
})

it('rolls back and says so when saving fails', async () => {
  vi.mocked(setActiveStatus).mockRejectedValue(new Error('offline'))
  await draw()
  await act(async () => sw().click())
  expect(sw().getAttribute('aria-checked')).toBe('true')
  expect(host.textContent).toContain("We couldn't save that. Try again.")
})
