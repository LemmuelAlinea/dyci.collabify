// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { JoinRequestsPanel } from './JoinRequestsPanel'
import type { GeneralProjectState } from '../useGeneralProject'
import { answerJoinRequest } from '../../../lib/api/general'
import { listSpaceMembers } from '../../../lib/api/spaces'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const toast = vi.hoisted(() => vi.fn())
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ show: toast }) }))
vi.mock('../../../lib/api/general', () => ({ answerJoinRequest: vi.fn(async () => {}) }))
vi.mock('../../../lib/api/spaces', () => ({
  listSpaceMembers: vi.fn(async () => [
    { user_id: 'u1', first_name: 'Ana', last_name: 'Cruz', avatar_url: null, level: 'member', joined_at: '', is_student: false },
  ]),
}))

const reload = vi.fn(async () => {})
const open = { id: 'r1', project_id: 'p1', user_id: 'u1', status: 'open', role: null, created_at: '2026-11-01T08:00:00Z', answered_by: null, answered_at: null }
const makeState = (over: Record<string, unknown> = {}) =>
  ({
    project: { id: 'p1', space_id: 's1' },
    myRole: 'pm', canGrant: true, archived: false,
    joinRequests: [open, { ...open, id: 'r2', user_id: 'u2', status: 'approved' }],
    reload,
    ...over,
  }) as unknown as GeneralProjectState

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

const show = (state: GeneralProjectState) => act(async () => root.render(<JoinRequestsPanel state={state} />))
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
const choose = (select: HTMLSelectElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })

it('lists open requests with the requester name', async () => {
  await show(makeState())
  expect(host.textContent).toContain('Ana Cruz')
  expect(host.querySelectorAll('li')).toHaveLength(1)
})

it('approves with the chosen role', async () => {
  await show(makeState())
  await choose(host.querySelector('select')!, 'qa')
  await act(async () => button('Approve')!.click())
  expect(answerJoinRequest).toHaveBeenCalledWith('r1', true, 'qa')
  expect(toast).toHaveBeenCalledWith('Ana Cruz joined as QA')
  expect(reload).toHaveBeenCalled()
})

it('says they joined when the name is not known', async () => {
  await show(makeState({ joinRequests: [{ ...open, user_id: 'u9' }] }))
  expect(host.textContent).toContain('Someone in your space')
  await act(async () => button('Approve')!.click())
  expect(toast).toHaveBeenCalledWith('They joined as Member')
})

it('starts a join request on the space role', async () => {
  vi.mocked(listSpaceMembers).mockResolvedValueOnce([
    { user_id: 'u1', first_name: 'Ana', last_name: 'Cruz', avatar_url: null, level: 'member', joined_at: '', is_student: false, role: 'qa' },
  ] as never)
  await show(makeState())
  expect(host.querySelector('select')!.value).toBe('qa')
  await act(async () => button('Approve')!.click())
  expect(answerJoinRequest).toHaveBeenCalledWith('r1', true, 'qa')
})

it('keeps a role the manager already changed when names arrive', async () => {
  let resolve!: (v: never) => void
  vi.mocked(listSpaceMembers).mockReturnValueOnce(new Promise((r) => (resolve = r as never)))
  await show(makeState())
  await choose(host.querySelector('select')!, 'stakeholder')
  await act(async () => resolve([{ user_id: 'u1', first_name: 'Ana', last_name: 'Cruz', role: 'qa' }] as never))
  expect(host.querySelector('select')!.value).toBe('stakeholder')
})

it('approves as Member by default', async () => {
  await show(makeState())
  await act(async () => button('Approve')!.click())
  expect(answerJoinRequest).toHaveBeenCalledWith('r1', true, 'member')
})

it('offers a coordinator every role but coordinator, and the manager all four', async () => {
  const values = (s: ParentNode) => [...s.querySelectorAll('option')].map((o) => o.value)
  await show(makeState({ myRole: 'coordinator' }))
  expect(values(host)).toEqual(['member', 'qa', 'stakeholder'])
  await show(makeState())
  expect(values(host)).toEqual(['member', 'coordinator', 'qa', 'stakeholder'])
})

it.each(['coordinator', 'pm'])('lets a coordinator approve a space %s as Coordinator', async (spaceRole) => {
  vi.mocked(listSpaceMembers).mockResolvedValueOnce([
    { user_id: 'u1', first_name: 'Ana', last_name: 'Cruz', avatar_url: null, level: 'member', joined_at: '', is_student: false, role: spaceRole },
  ] as never)
  await show(makeState({ myRole: 'coordinator' }))
  expect(host.querySelector('select')!.value).toBe('coordinator')
  await act(async () => button('Approve')!.click())
  expect(answerJoinRequest).toHaveBeenCalledWith('r1', true, 'coordinator')
})

it('declines without a role', async () => {
  await show(makeState())
  await act(async () => button('Decline')!.click())
  expect(answerJoinRequest).toHaveBeenCalledWith('r1', false)
  expect(toast).toHaveBeenCalledWith('Request declined')
})

it('shows nothing without open requests, or to someone who cannot answer', async () => {
  await show(makeState({ joinRequests: [] }))
  expect(host.textContent).toBe('')
  await show(makeState({ canGrant: false }))
  expect(host.textContent).toBe('')
})

it('says what went wrong when the answer fails', async () => {
  vi.mocked(answerJoinRequest).mockRejectedValueOnce(new Error('Nope'))
  await show(makeState())
  await act(async () => button('Approve')!.click())
  expect(toast).toHaveBeenCalledWith(expect.any(String), 'error')
})
