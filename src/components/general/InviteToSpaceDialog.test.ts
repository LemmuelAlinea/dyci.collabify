// @vitest-environment happy-dom
import * as React from 'react'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { InviteToSpaceDialog } from './InviteToSpaceDialog'
import { ToastContext } from '../ui/Toast'
import { inviteToSpace } from '../../lib/api/spaces'

vi.mock('../../lib/api/spaces', () => ({ inviteToSpace: vi.fn() }))
vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

it.each([true, false])('invites the selected search result (injected: %s)', async (injected) => {
  vi.useFakeTimers()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const invite = vi.fn().mockResolvedValue(undefined)
  const onDone = vi.fn().mockResolvedValue(undefined)
  const onClose = vi.fn()
  const search = vi.fn().mockResolvedValue([
    { person_id: 'selected-person', first_name: 'Alex', last_name: 'Reyes', avatar_url: null },
  ])
  try {
    await act(async () => root.render(createElement(ToastContext.Provider, { value: { show: vi.fn() } },
      createElement(InviteToSpaceDialog, {
        open: true, spaceId: 'selected-space', onDone, onClose, search,
        invite: injected ? invite : undefined,
      }),
    )))
    const input = document.querySelector('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Alex')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(250) })
    expect(search).toHaveBeenCalledWith('Alex')
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent === 'Invite')!
    await act(async () => button.click())
    expect(injected ? invite : inviteToSpace).toHaveBeenCalledExactlyOnceWith('selected-space', 'selected-person')
    expect(injected ? inviteToSpace : invite).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
    expect(document.querySelector('select')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

it('shows a role select and passes the chosen role when roles are given', async () => {
  vi.useFakeTimers()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const invite = vi.fn().mockResolvedValue(undefined)
  const search = vi.fn().mockResolvedValue([
    { person_id: 'p', first_name: 'Alex', last_name: 'Reyes', avatar_url: null },
  ])
  try {
    await act(async () => root.render(createElement(ToastContext.Provider, { value: { show: vi.fn() } },
      createElement(InviteToSpaceDialog, {
        open: true, spaceId: 's', onDone: vi.fn().mockResolvedValue(undefined), onClose: vi.fn(), search, invite,
        roles: ['coordinator', 'member', 'qa'],
      }),
    )))
    const select = document.querySelector('select')!
    expect(select.value).toBe('member')
    expect([...select.options].map((o) => o.textContent)).toEqual(['Coordinator', 'Member', 'QA'])
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'qa')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const input = document.querySelector('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Alex')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(250) })
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent === 'Invite')!
    await act(async () => button.click())
    expect(invite).toHaveBeenCalledExactlyOnceWith('s', 'p', 'qa')
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

it('starts every opening on Member', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const draw = (open: boolean) => act(async () => root.render(createElement(ToastContext.Provider, { value: { show: vi.fn() } },
    createElement(InviteToSpaceDialog, {
      open, spaceId: 's', onDone: vi.fn().mockResolvedValue(undefined), onClose: vi.fn(),
      search: vi.fn().mockResolvedValue([]), invite: vi.fn(), roles: ['coordinator', 'member'],
    }),
  )))
  try {
    await draw(true)
    const select = document.querySelector('select')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'coordinator')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(document.querySelector('select')!.value).toBe('coordinator')
    await draw(false)
    await draw(true)
    expect(document.querySelector('select')!.value).toBe('member')
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
