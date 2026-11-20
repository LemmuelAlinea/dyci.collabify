// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ people: [] as Array<{ identity: string; name: string; isLocal: boolean; attributes: Record<string, string> }> }))
vi.mock('@livekit/components-react', () => ({
  useParticipants: () => mock.people,
  useRoomContext: () => ({ on: vi.fn(), off: vi.fn() }),
}))
import { CallPeople } from './CallPeople'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  mock.people = [
    { identity: 'one', name: 'One', isLocal: true, attributes: {} },
    { identity: 'two', name: 'Two', isLocal: false, attributes: { 'collabify.hand': '1' } },
  ]
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
const show = (canHost: boolean, onAction = vi.fn()) => act(async () => root.render(<CallPeople canHost={canHost} locked={false} onAction={onAction} onClose={vi.fn()} />))

it('shows raised hands first and hides moderation from a nonhost', async () => {
  await show(false)
  expect(host.querySelector('li')?.textContent).toContain('Two')
  expect(host.textContent).toContain('Hand raised')
  expect(host.textContent).not.toContain('Remove')
  expect(host.textContent).not.toContain('Lock room')
})

it('lets a host clear a raised hand', async () => {
  const action = vi.fn()
  await show(true, action)
  const lower = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Lower hand')!
  await act(async () => lower.click())
  expect(action).toHaveBeenCalledWith('clear_hand', 'two')
  expect(host.textContent).toContain('Remove')
})
