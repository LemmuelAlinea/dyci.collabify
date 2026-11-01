// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { MembersSection } from './MembersSection'
import type { GeneralProjectState } from '../useGeneralProject'
import { updateGeneralProject } from '../../../lib/api/general'
import { useToast } from '../../ui/Toast'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../ui/Toast', () => {
  const show = vi.fn()
  return { useToast: () => ({ show }) }
})
vi.mock('../../../lib/api/general', async (original) => ({
  ...(await original<typeof import('../../../lib/api/general')>()),
  updateGeneralProject: vi.fn(async () => {}),
}))
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ profile: null }) }))
vi.mock('../../../hooks/useLive', () => ({ useLive: () => {} }))

it('keeps requests and invitations inside their action dialogs', async () => {
  const state = {
    project: null,
    canGrant: true,
    archived: false,
    myRole: 'pm',
    can: () => true,
    isOwner: false,
    requests: [],
    joinRequests: [],
    members: [],
    teams: [],
    holders: [],
    positions: [],
  } as unknown as GeneralProjectState
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<MemoryRouter><MembersSection state={state} /></MemoryRouter>))
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

afterEach(() => vi.clearAllMocks())

const reload = vi.fn(async () => {})

function optionsState(over: Record<string, unknown> = {}, memberRules = { manageMilestones: false, createTasks: false }) {
  return {
    project: { id: 'p1', class_board_id: null, updated_at: 't1', memberRules },
    canGrant: true,
    archived: false,
    readOnly: false,
    myRole: 'pm',
    myOpenRequests: [],
    myGrants: [],
    can: () => true,
    isOwner: true,
    requests: [],
    joinRequests: [],
    members: [],
    teams: [],
    holders: [],
    positions: [],
    teamMembers: [],
    reload,
    ...over,
  } as unknown as GeneralProjectState
}

async function withHost(run: (host: HTMLDivElement, render: (state: GeneralProjectState) => Promise<void>) => Promise<void>) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await run(host, (state) => act(async () => root.render(<MemoryRouter><MembersSection state={state} /></MemoryRouter>)))
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
}

const switchOf = (host: HTMLElement, label: string) => host.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${label}"]`)
const buttonOf = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

it('shows the member options with their help text', async () => {
  await withHost(async (host, render) => {
    await render(optionsState())
    expect(host.textContent).toContain('Member options')
    expect(host.textContent).toContain('Create, edit and mark milestones reached. Tagging tasks still needs Manage tasks.')
    expect(host.textContent).toContain('Their tasks start in planning for the project manager or a coordinator to send.')
    expect(switchOf(host, 'Members can manage milestones')?.getAttribute('aria-checked')).toBe('false')
    expect(switchOf(host, 'Members can create tasks')?.getAttribute('aria-checked')).toBe('false')
  })
})

it('saves both switches in one update and says so', async () => {
  await withHost(async (host, render) => {
    await render(optionsState({}, { manageMilestones: false, createTasks: true }))
    expect(switchOf(host, 'Members can create tasks')?.getAttribute('aria-checked')).toBe('true')
    await act(async () => switchOf(host, 'Members can manage milestones')!.click())
    await act(async () => buttonOf(host, 'Save member options')!.click())
    expect(updateGeneralProject).toHaveBeenCalledExactlyOnceWith('p1', { members_manage_milestones: true, members_create_tasks: true })
    expect(reload).toHaveBeenCalled()
    expect(useToast().show).toHaveBeenCalledWith('Member options saved')
  })
})

it('shows the error and keeps the switches when the save fails', async () => {
  vi.mocked(updateGeneralProject).mockRejectedValueOnce(new Error('That change did not go through.'))
  await withHost(async (host, render) => {
    await render(optionsState())
    await act(async () => switchOf(host, 'Members can create tasks')!.click())
    await act(async () => buttonOf(host, 'Save member options')!.click())
    expect(host.textContent).toContain('That change did not go through.')
    expect(switchOf(host, 'Members can create tasks')?.getAttribute('aria-checked')).toBe('true')
    expect(useToast().show).not.toHaveBeenCalledWith('Member options saved')
  })
})

it('reads only for anyone but the project manager, and while the project is read-only', async () => {
  await withHost(async (host, render) => {
    await render(optionsState({ can: () => false, myRole: 'coordinator' }, { manageMilestones: true, createTasks: false }))
    expect(switchOf(host, 'Members can manage milestones')?.getAttribute('aria-checked')).toBe('true')
    expect(switchOf(host, 'Members can manage milestones')?.disabled).toBe(true)
    expect(switchOf(host, 'Members can create tasks')?.disabled).toBe(true)
    expect(buttonOf(host, 'Save member options')).toBeUndefined()
    await render(optionsState({ readOnly: true }))
    expect(switchOf(host, 'Members can create tasks')?.disabled).toBe(true)
    expect(buttonOf(host, 'Save member options')).toBeUndefined()
  })
})

it('leaves the panel out of a class board', async () => {
  await withHost(async (host, render) => {
    const state = optionsState()
    await render({ ...state, project: { ...state.project!, class_board_id: 'c1' } } as GeneralProjectState)
    expect(host.textContent).not.toContain('Member options')
  })
})
