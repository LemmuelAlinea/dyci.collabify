// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NewProjectDialog } from './NewProjectDialog'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../lib/api/general', () => ({
  createGeneralProject: vi.fn(),
  createSpaceTeam: vi.fn(),
  deleteTemplate: vi.fn(),
  listMyTemplates: vi.fn(async () => []),
  listMySpaceTeams: vi.fn(async () => []),
}))
vi.mock('../../lib/api/projectRequests', () => ({ createProjectFromRequest: vi.fn() }))

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

async function teamOptions(spaceRole: 'pm' | 'coordinator' | 'member' | null) {
  await act(async () =>
    root.render(
      <MemoryRouter>
        <NewProjectDialog open onClose={() => {}} spaceId="s1" spaceRole={spaceRole} />
      </MemoryRouter>,
    ),
  )
  const select = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'none'))!
  return [...select.options].map((o) => o.value)
}

it.each(['pm', 'coordinator'] as const)('offers a new space team to the space %s', async (role) => {
  expect(await teamOptions(role)).toContain('new')
})

it.each(['member', null] as const)('does not offer a new space team to %s', async (role) => {
  expect(await teamOptions(role)).toEqual(['none'])
})
