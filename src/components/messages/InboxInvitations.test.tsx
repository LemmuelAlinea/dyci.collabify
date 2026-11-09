// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { InboxInvitations } from './InboxInvitations'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'me' } }) }))
vi.mock('../../hooks/usePendingInvitations', () => ({
  usePendingInvitations: () => ({ invitations: [], error: null, reload: vi.fn() }),
}))
vi.mock('../../lib/api/general', () => ({ respondToInvitation: vi.fn() }))
vi.mock('../../lib/api/spaces', () => ({ respondToSpaceInvitation: vi.fn() }))

const invite = (id: string, extra: Record<string, unknown>) => ({
  invitation_id: id,
  space_id: id,
  space_name: `Space ${id}`,
  space_description: '',
  inviter_id: null,
  inviter_first_name: null,
  inviter_last_name: null,
  inviter_avatar_url: null,
  created_at: '2026-01-01',
  invited_level: 'member',
  invited_role: 'member',
  ...extra,
})

vi.mock('../../context/generalNavigation', () => ({
  useGeneralNavigation: () => ({
    spaces: [],
    reload: vi.fn(),
    invitations: [
      invite('a', { space_kind: 'work', invited_role: 'qa' }),
      invite('b', { space_kind: 'work', invited_role: 'coordinator' }),
      invite('c', { space_kind: 'education', invited_role: 'member' }),
    ],
  }),
}))

it('names the invited role on a space invitation and nothing on a class one', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(createElement(MemoryRouter, null, createElement(InboxInvitations))))
  const li = (name: string) =>
    [...container.querySelectorAll('li')].find((n) => n.textContent?.includes(name))!
  expect(li('Space a').textContent).toContain('QA')
  expect(li('Space b').textContent).toContain('Coordinator')
  expect(li('Space b').textContent).not.toContain('Owner')
  expect(li('Space c').textContent).not.toContain('Member')
  await act(async () => root.unmount())
  container.remove()
})
