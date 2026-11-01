// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { JoinRequestButton } from './JoinRequestButton'
import type { GeneralProjectState } from './useGeneralProject'
import { requestToJoin, withdrawJoinRequest } from '../../lib/api/general'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const toast = vi.hoisted(() => vi.fn())
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: toast }) }))
vi.mock('../../lib/api/general', () => ({
  requestToJoin: vi.fn(async () => 'r1'),
  withdrawJoinRequest: vi.fn(async () => {}),
}))

const reload = vi.fn(async () => {})
const makeState = (joinRequests: unknown[] = []) =>
  ({ project: { id: 'p1' }, viewerId: 'me', joinRequests, reload }) as unknown as GeneralProjectState

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

const show = (state: GeneralProjectState) => act(async () => root.render(<JoinRequestButton state={state} />))
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

it('asks to join, then says the request was sent', async () => {
  await show(makeState())
  await act(async () => button('Ask to join')!.click())
  expect(requestToJoin).toHaveBeenCalledWith('p1')
  expect(toast).toHaveBeenCalledWith('Request sent')
  expect(reload).toHaveBeenCalled()
  expect(host.textContent).toContain('Request sent')
  expect(button('Ask to join')).toBeUndefined()
})

it('shows a request that is already open and withdraws it', async () => {
  await show(makeState([{ id: 'r9', user_id: 'me', status: 'open' }]))
  expect(host.textContent).toContain('Request sent')
  await act(async () => button('Withdraw')!.click())
  expect(withdrawJoinRequest).toHaveBeenCalledWith('r9')
  expect(toast).toHaveBeenCalledWith('Request withdrawn')
  expect(button('Ask to join')).toBeTruthy()
})

it('ignores other people and answered requests of the viewer', async () => {
  await show(makeState([
    { id: 'a', user_id: 'someone', status: 'open' },
    { id: 'b', user_id: 'me', status: 'declined' },
  ]))
  expect(button('Ask to join')).toBeTruthy()
})

it('says what went wrong when the request fails', async () => {
  vi.mocked(requestToJoin).mockRejectedValueOnce(new Error('Nope'))
  await show(makeState())
  await act(async () => button('Ask to join')!.click())
  expect(toast).toHaveBeenCalledWith(expect.any(String), 'error')
  expect(button('Ask to join')).toBeTruthy()
})
