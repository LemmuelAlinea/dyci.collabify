// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { InvitePanel } from './InvitePanel'
import type { GeneralProjectState } from './useGeneralProject'
import { searchPeople } from '../../lib/api/general'
import { listSpaceMembers } from '../../lib/api/spaces'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const toast = vi.hoisted(() => ({ show: vi.fn() }))
vi.mock('../ui/Toast', () => ({ useToast: () => toast }))
vi.mock('../../hooks/useLive', () => ({ useLive: () => {} }))
vi.mock('../../lib/api/general', () => ({
  inviteToProject: vi.fn(async () => {}),
  listProjectInvitations: vi.fn(async () => []),
  searchPeople: vi.fn(async () => [
    { person_id: 'u1', first_name: 'Ana', last_name: 'Cruz', avatar_url: null, email: null },
  ]),
  setJoinCode: vi.fn(async () => {}),
  withdrawInvitation: vi.fn(async () => {}),
}))
vi.mock('../../lib/api/spaces', () => ({ listSpaceMembers: vi.fn(async () => []) }))

const spaceMember = (role?: string) => ({
  user_id: 'u1', first_name: 'Ana', last_name: 'Cruz', avatar_url: null, level: 'member', joined_at: '', is_student: false, role,
})
const makeState = (over: Record<string, unknown> = {}) =>
  ({
    project: { id: 'p1', space_id: 's1', class_board_id: null, join_open: false },
    myRole: 'pm',
    can: () => true,
    members: [],
    isOwner: false,
    archived: false,
    reload: vi.fn(async () => {}),
    ...over,
  }) as unknown as GeneralProjectState

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.clearAllMocks()
})

async function openPick(state: GeneralProjectState) {
  await act(async () => root.render(<InvitePanel state={state} />))
  const input = host.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Ana')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400)
  })
  const invite = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Invite')!
  await act(async () => invite.click())
  return host.querySelector('select') as HTMLSelectElement
}
const values = (s: ParentNode) => [...s.querySelectorAll('option')].map((o) => o.value)

it("starts the invite on the person's space role", async () => {
  vi.mocked(listSpaceMembers).mockResolvedValueOnce([spaceMember('qa')] as never)
  expect((await openPick(makeState())).value).toBe('qa')
})

it('falls back to Member when the person has no space role', async () => {
  vi.mocked(listSpaceMembers).mockResolvedValueOnce([spaceMember(undefined)] as never)
  expect((await openPick(makeState())).value).toBe('member')
})

it('starts on Member when the space list fails to load', async () => {
  vi.mocked(listSpaceMembers).mockRejectedValueOnce(new Error('Nope'))
  expect((await openPick(makeState())).value).toBe('member')
})

it('offers a coordinator the Coordinator choice only for a space Coordinator', async () => {
  vi.mocked(listSpaceMembers).mockResolvedValueOnce([spaceMember('coordinator')] as never)
  const select = await openPick(makeState({ myRole: 'coordinator' }))
  expect(values(select)).toEqual(['member', 'qa', 'stakeholder', 'coordinator'])
  expect(select.value).toBe('coordinator')
})

it('starts a coordinator inviting the space project manager on Coordinator', async () => {
  vi.mocked(listSpaceMembers).mockResolvedValueOnce([spaceMember('pm')] as never)
  const select = await openPick(makeState({ myRole: 'coordinator' }))
  expect(values(select)).toEqual(['member', 'qa', 'stakeholder', 'coordinator'])
  expect(select.value).toBe('coordinator')
})

it('keeps the usual choices for a coordinator inviting someone without that role', async () => {
  vi.mocked(listSpaceMembers).mockResolvedValueOnce([spaceMember('qa')] as never)
  const select = await openPick(makeState({ myRole: 'coordinator' }))
  expect(values(select)).toEqual(['member', 'qa', 'stakeholder'])
})

it('skips the space lookup on a class board project', async () => {
  const state = makeState({ project: { id: 'p1', space_id: 's1', class_board_id: 'b1', join_open: false } })
  expect((await openPick(state)).value).toBe('member')
  expect(listSpaceMembers).not.toHaveBeenCalled()
  expect(searchPeople).toHaveBeenCalled()
})
