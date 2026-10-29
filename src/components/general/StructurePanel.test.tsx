// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { StructurePanel } from './StructurePanel'
import type { GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))

it('opens team details and creates positions in that team', async () => {
  const state = {
    project: { id: 'project', class_board_id: null },
    can: () => true,
    teams: [{ id: 'team', name: 'Design', leader_id: null }],
    teamMembers: [],
    positions: [],
    holders: [],
    members: [],
    nameOf: (id: string) => id,
    roleOf: () => 'member',
  } as unknown as GeneralProjectState
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<StructurePanel state={state} />))
    expect(host.textContent).toContain('Design')
    expect(host.textContent).not.toContain('Create position')
    await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Design'))!.click())
    const team = document.querySelector('[role="dialog"][aria-label="Design"]')!
    expect(team.textContent).toContain('Create position')
    await act(async () => [...team.querySelectorAll('button')].find((button) => button.textContent?.includes('Create position'))!.click())
    const position = document.querySelector('[role="dialog"][aria-label="Create position"]')!
    expect(position.textContent).toContain('In Design')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
