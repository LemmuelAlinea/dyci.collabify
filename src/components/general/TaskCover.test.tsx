// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TaskCover } from './TaskCover'
import { handBackCover, keepCover, taskCover } from '../../lib/api/workload'
import type { GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../../lib/api/workload', () => ({
  taskCover: vi.fn(),
  handBackCover: vi.fn(async () => {}),
  keepCover: vi.fn(async () => {}),
}))

const names: Record<string, string> = { ivan: 'Ivan Cruz', keneth: 'Keneth Lim', bo: 'Bo Reyes', pm: 'Lemmuel Alinea' }
const stateAs = (viewerId: string, myRole = 'member') =>
  ({ viewerId, myRole, readOnly: false, nameOf: (id: string) => names[id] ?? id, reload: vi.fn(async () => {}) }) as unknown as GeneralProjectState

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.mocked(taskCover).mockResolvedValue({ id: 'c1', task_id: 't1', away_id: 'ivan', cover_id: 'keneth', until: '2026-11-28' })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

async function render(state: GeneralProjectState) {
  await act(async () => root.render(<TaskCover taskId="t1" state={state} />))
  await act(async () => {})
}
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text)

it('cover box shown', async () => {
  await render(stateAs('bo'))
  expect(host.textContent).toContain('Keneth Lim is covering for Ivan Cruz until Sat 28 Nov')
})

it('hand back calls RPC and reloads', async () => {
  const state = stateAs('keneth')
  await render(state)
  vi.mocked(taskCover).mockResolvedValue(null)
  await act(async () => button('Hand back to Ivan Cruz')!.click())
  expect(handBackCover).toHaveBeenCalledWith('c1')
  expect(state.reload).toHaveBeenCalled()
  expect(host.textContent).toBe('')
})

it('keep calls RPC', async () => {
  await render(stateAs('pm', 'pm'))
  await act(async () => button('Keep with Keneth Lim')!.click())
  expect(keepCover).toHaveBeenCalledWith('c1')
})

it('buttons hidden for others', async () => {
  await render(stateAs('bo'))
  expect(button('Hand back to Ivan Cruz')).toBeUndefined()
  await act(async () => root.render(<TaskCover taskId="t1" state={{ ...stateAs('pm', 'pm'), readOnly: true } as GeneralProjectState} />))
  expect(button('Hand back to Ivan Cruz')).toBeUndefined()
})

it('refusal shows its message', async () => {
  vi.mocked(handBackCover).mockRejectedValueOnce(new Error('Reopen it before changing who holds it.'))
  await render(stateAs('keneth'))
  await act(async () => button('Hand back to Ivan Cruz')!.click())
  expect(host.textContent).toContain('Reopen it before changing who holds it.')
})
