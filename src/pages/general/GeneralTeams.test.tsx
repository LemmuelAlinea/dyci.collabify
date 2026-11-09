// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import GeneralTeams from './GeneralTeams'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../../hooks/useLive', () => ({ useLive: () => {} }))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'me', can_manage_projects: true, role: 'member' } }),
}))

const team = {
  id: 't1', space_id: 's', name: 'Design', description: '', created_by: null, created_at: '', updated_at: '',
  archived_at: null, my_level: null, member_count: 2, project_count: 0,
}
const listSpaceTeams = vi.fn()
vi.mock('../../lib/api/general', () => ({
  addSpaceTeamMember: vi.fn(),
  archiveSpaceTeam: vi.fn(),
  createSpaceTeam: vi.fn(),
  deleteSpaceTeam: vi.fn(),
  listSpaceTeamMembers: async () => [
    { team_id: 't1', user_id: 'u1', level: 'member', first_name: 'Ana', last_name: 'Cruz', avatar_url: null },
  ],
  listSpaceTeams: (...args: unknown[]) => listSpaceTeams(...args),
  removeSpaceTeamMember: vi.fn(),
  updateSpaceTeam: vi.fn(),
}))
vi.mock('../../lib/api/spaces', () => ({
  listSpaceMembers: async () => [
    { user_id: 'u1', first_name: 'Ana', last_name: 'Cruz', avatar_url: null },
    { user_id: 'u2', first_name: 'Ben', last_name: 'Diaz', avatar_url: null },
  ],
}))

let space: Record<string, unknown> = {}
vi.mock('../../context/generalNavigation', () => ({
  useGeneralNavigation: () => ({
    spaces: [space], currentSpace: space, currentSpaceId: 's', error: null, reload: vi.fn(),
  }),
}))

beforeEach(() => listSpaceTeams.mockReset().mockResolvedValue([team]))

async function renderAs(role: string, check: (c: HTMLDivElement) => void, url = '/') {
  space = { id: 's', name: 'Capstone', kind: 'work', archived_at: null, my_level: 'member', my_role: role }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(createElement(MemoryRouter, { initialEntries: [url] }, createElement(GeneralTeams))),
    )
    check(container)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
}

const buttons = (c: HTMLElement) => [...c.querySelectorAll('button')].map((b) => b.textContent?.trim())
const controls = ['Edit', 'Archive', 'Delete', 'Add', 'Remove', 'Create team']

it('a member sees every team with no edit, archive, add or remove controls', async () => {
  await renderAs('member', (c) => {
    expect(c.textContent).toContain('Design')
    for (const label of controls) expect(buttons(c)).not.toContain(label)
  })
})

it('a coordinator sees those controls on a team they are not on', async () => {
  await renderAs('coordinator', (c) => {
    for (const label of ['Edit', 'Archive', 'Delete', 'Add', 'Remove', 'Create team']) {
      expect(buttons(c)).toContain(label)
    }
  })
})

it('shows no Create team button to a member who has the Project manager switch', async () => {
  await renderAs('member', (c) => expect(buttons(c)).not.toContain('Create team'))
})

it('reads the archived teams view from ?archived=1', async () => {
  await renderAs('member', (c) => {
    expect(listSpaceTeams).toHaveBeenCalledWith('s', true)
    expect(c.querySelector('h2')?.textContent).toBe('Archived teams')
  }, '/?archived=1')
})
