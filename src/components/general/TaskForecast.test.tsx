// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TaskForecast } from './TaskForecast'
import { taskForecast } from '../../lib/api/workload'
import type { GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../lib/api/workload', () => ({ taskForecast: vi.fn() }))

const state = { viewerId: 'me', nameOf: (id: string) => (id === 'ivan' ? 'Ivan Cruz' : id) } as unknown as GeneralProjectState
let host: HTMLDivElement
let root: Root
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllMocks() })

async function render() {
  await act(async () => root.render(<TaskForecast taskId="t1" state={state} />))
  await act(async () => {})
}

it('forecast line for a short holder', async () => {
  vi.mocked(taskForecast).mockResolvedValue([{ user_id: 'ivan', remaining_minutes: 600, short_minutes: 300 }])
  await render()
  expect(taskForecast).toHaveBeenCalledWith('t1')
  expect(host.textContent).toBe("Needs 5 h more than Ivan Cruz has before it's due")
})

it('forecast says you', async () => {
  vi.mocked(taskForecast).mockResolvedValue([{ user_id: 'me', remaining_minutes: 600, short_minutes: 90 }])
  await render()
  expect(host.textContent).toBe("Needs 1.5 h more than you have before it's due")
})

it('no forecast no line', async () => {
  vi.mocked(taskForecast).mockResolvedValue([])
  await render()
  expect(host.innerHTML).toBe('')
})
