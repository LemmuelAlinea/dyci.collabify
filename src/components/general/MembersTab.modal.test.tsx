// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { MembersTab } from './MembersTab'
import type { GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../ui/Toast', () => {
  const show = vi.fn()
  return { useToast: () => ({ show }) }
})
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ profile: null }) }))
vi.mock('../../hooks/useLive', () => ({ useLive: () => {} }))

it('keeps requests and invitations inside their action dialogs', async () => {
  const state = {
    project: null,
    canGrant: true,
    archived: false,
    myRole: 'pm',
    can: () => true,
    isOwner: false,
    requests: [],
    members: [],
    teams: [],
    holders: [],
    positions: [],
  } as unknown as GeneralProjectState
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<MemoryRouter><MembersTab state={state} /></MemoryRouter>))
    expect(host.textContent).not.toContain('Nothing waiting on you.')
    await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Access requests')!.click())
    expect(document.querySelector('[role="dialog"][aria-label="Access requests"]')?.textContent).toContain('Nothing waiting on you.')
    await act(async () => document.querySelector('[role="dialog"][aria-label="Access requests"] button[aria-label="Close"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Invite people')!.click())
    expect(document.querySelector('[role="dialog"][aria-label="Bring people in"]')?.textContent).toContain('Invite someone, or share a join code.')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
