// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SpaceMembers from './SpaceMembers'
import { searchPeople } from '../../lib/api/general'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const show = vi.fn()
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ show }) }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'me' } }) }))
vi.mock('../../hooks/useLive', () => ({ useLive: () => {} }))
vi.mock('../../hooks/useSpaces', () => ({ forgetSpace: vi.fn() }))
vi.mock('../../lib/api/general', () => ({ searchPeople: vi.fn() }))

const api = vi.hoisted(() => ({
  handOverSpace: vi.fn(),
  inviteSpaceMember: vi.fn(),
  inviteToSpace: vi.fn(),
  listSpaceInvitations: vi.fn(),
  listSpaceMembers: vi.fn(),
  previewSpaceRole: vi.fn(),
  removeSpaceMember: vi.fn(),
  setSpaceRole: vi.fn(),
  withdrawSpaceInvitation: vi.fn(),
}))
vi.mock('../../lib/api/spaces', () => api)

let space: Record<string, unknown> = {}
const reload = vi.fn()
vi.mock('../../context/generalNavigation', () => ({
  useGeneralNavigation: () => ({ spaces: [space], currentSpace: space, error: null, reload }),
}))

const person = (id: string, first: string, role: string, is_student = false) => ({
  user_id: id,
  first_name: first,
  last_name: 'Cruz',
  avatar_url: null,
  level: 'member',
  joined_at: '2026-01-01',
  is_student,
  role,
})

const people = [
  person('me', 'Me', 'pm'),
  person('c1', 'Cora', 'coordinator'),
  person('m1', 'Mia', 'member'),
  person('s1', 'Stu', 'member', true),
]

beforeEach(() => {
  vi.clearAllMocks()
  api.listSpaceInvitations.mockResolvedValue([])
  api.previewSpaceRole.mockResolvedValue({ project_count: 0, task_count: 0, qa_start_count: 0 })
  api.setSpaceRole.mockResolvedValue(0)
  api.handOverSpace.mockResolvedValue(undefined)
})

afterEach(() => {
  document.body.innerHTML = ''
})

async function renderAs(
  role: string,
  members: ReturnType<typeof person>[],
  check: (c: HTMLElement) => void | Promise<void>,
) {
  space = { id: 's', name: 'Capstone', kind: 'work', class_id: null, archived_at: null, my_role: role }
  api.listSpaceMembers.mockResolvedValue(members)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/s'] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: '/:spaceId', element: createElement(SpaceMembers) }),
        ),
      ),
    ),
  )
  try {
    await check(container)
  } finally {
    await act(async () => root.unmount())
  }
}

const row = (c: HTMLElement, name: string) =>
  [...c.querySelectorAll('li')].find((li) => li.textContent?.includes(name))!
const labels = (el: Element) => [...el.querySelectorAll('button')].map((b) => b.textContent)
const options = (el: Element) => [...el.querySelectorAll('option')].map((o) => o.textContent)
const button = (text: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll('button')].filter((b) => b.textContent === text).pop()!
const choose = (select: HTMLSelectElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })

it('shows the project manager as a label with no dropdown or remove button', async () => {
  await renderAs('coordinator', [person('pm1', 'Pam', 'pm'), person('me', 'Me', 'coordinator')], (c) => {
    const pm = row(c, 'Pam')
    expect(pm.querySelector('select')).toBeNull()
    expect(pm.textContent).toContain('Project manager')
    expect(labels(pm)).not.toContain('Remove')
  })
})

it('offers four roles to the project manager, for a student too', async () => {
  await renderAs('pm', people, (c) => {
    expect(options(row(c, 'Mia'))).toEqual(['Coordinator', 'Member', 'QA', 'Stakeholder'])
    expect(options(row(c, 'Stu'))).toEqual(['Coordinator', 'Member', 'QA', 'Stakeholder'])
    expect(row(c, 'Me').querySelector('select')).toBeNull()
  })
})

it('offers three roles to a coordinator and a label for another coordinator', async () => {
  await renderAs('coordinator', [person('me', 'Me', 'coordinator'), people[1], people[2]], (c) => {
    expect(options(row(c, 'Mia'))).toEqual(['Member', 'QA', 'Stakeholder'])
    expect(row(c, 'Cora').querySelector('select')).toBeNull()
    expect(row(c, 'Cora').textContent).toContain('Coordinator')
    expect(labels(row(c, 'Cora'))).not.toContain('Remove')
  })
})

it('shows a member labels only, and still the leave section', async () => {
  await renderAs('member', [person('me', 'Me', 'member'), people[2]], (c) => {
    expect(c.querySelector('select')).toBeNull()
    expect(labels(c)).not.toContain('Remove')
    expect(labels(c)).not.toContain('Invite a member')
    expect(labels(c)).toContain('Leave')
  })
})

it('saves straight away when the preview releases nothing', async () => {
  await renderAs('pm', people, async (c) => {
    await choose(row(c, 'Mia').querySelector('select')!, 'qa')
    expect(api.previewSpaceRole).toHaveBeenCalledWith('s', 'm1', 'qa')
    expect(api.setSpaceRole).toHaveBeenCalledWith('s', 'm1', 'qa')
    expect(document.body.textContent).not.toContain('Change this role?')
    expect(show).toHaveBeenCalledWith('Mia is now QA in this space')
    expect(reload).toHaveBeenCalled()
  })
})

it('asks first when tasks would be released', async () => {
  api.previewSpaceRole.mockResolvedValue({ project_count: 1, task_count: 2, qa_start_count: 0 })
  await renderAs('pm', people, async (c) => {
    await choose(row(c, 'Mia').querySelector('select')!, 'stakeholder')
    expect(api.setSpaceRole).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('This moves Mia to Stakeholder in 1 project.')
    expect(document.body.textContent).toContain('They let go of 2 tasks.')
    expect(document.body.textContent).not.toContain('QA review starts')
    await act(async () => button('Change role').click())
    expect(api.setSpaceRole).toHaveBeenCalledWith('s', 'm1', 'stakeholder')
  })
})

it('asks first when a QA gate would start', async () => {
  api.previewSpaceRole.mockResolvedValue({ project_count: 2, task_count: 0, qa_start_count: 1 })
  await renderAs('pm', people, async (c) => {
    await choose(row(c, 'Mia').querySelector('select')!, 'qa')
    expect(document.body.textContent).toContain('This moves Mia to QA in 2 projects.')
    expect(document.body.textContent).toContain('QA review starts in 1 project.')
    expect(document.body.textContent).not.toContain('let go')
    expect(api.setSpaceRole).not.toHaveBeenCalled()
  })
})

it('does not save when the dialog is cancelled', async () => {
  api.previewSpaceRole.mockResolvedValue({ project_count: 1, task_count: 2, qa_start_count: 0 })
  await renderAs('pm', people, async (c) => {
    await choose(row(c, 'Mia').querySelector('select')!, 'qa')
    await act(async () => button('Cancel').click())
    expect(api.setSpaceRole).not.toHaveBeenCalled()
  })
})

it('offers hand over to the project manager only, never for a student', async () => {
  await renderAs('pm', people, async (c) => {
    expect(labels(row(c, 'Mia'))).toContain('Hand over')
    expect(labels(row(c, 'Stu'))).not.toContain('Hand over')
    expect(labels(row(c, 'Me'))).not.toContain('Hand over')
    expect(c.textContent).toContain('Hand over the space before leaving.')
    expect(labels(c)).not.toContain('Leave')
    await act(async () => button('Hand over', row(c, 'Mia')).click())
    expect(document.body.textContent).toContain('Hand over this space?')
    expect(document.body.textContent).toContain(
      'Mia becomes the project manager, and you become a coordinator.',
    )
    await act(async () => button('Hand over').click())
    expect(api.handOverSpace).toHaveBeenCalledWith('s', 'm1')
  })
  await renderAs('coordinator', [person('me', 'Me', 'coordinator'), people[2]], (c) => {
    expect(labels(c)).not.toContain('Hand over')
  })
})

it('passes the chosen role through the invite dialog', async () => {
  vi.useFakeTimers()
  vi.mocked(searchPeople).mockResolvedValue([
    { person_id: 'p9', first_name: 'Ana', last_name: 'Lim', avatar_url: null, email: 'ana@example.com' },
  ])
  api.inviteSpaceMember.mockResolvedValue(undefined)
  try {
    await renderAs('pm', people, async (c) => {
      await act(async () => button('Invite a member', c).click())
      expect(document.body.textContent).toContain('They join this space with the role you choose.')
      const select = document.querySelector<HTMLSelectElement>('select[id]')!
      expect([...select.options].map((o) => o.textContent)).toEqual([
        'Coordinator',
        'Member',
        'QA',
        'Stakeholder',
      ])
      expect(select.value).toBe('member')
      await choose(select, 'qa')
      const input = document.querySelector<HTMLInputElement>('input')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Ana')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250)
      })
      await act(async () => button('Invite').click())
      expect(api.inviteSpaceMember).toHaveBeenCalledWith('s', 'p9', 'qa')
    })
  } finally {
    vi.useRealTimers()
  }
})

it('shows no Add a co-owner button in a work space', async () => {
  await renderAs('pm', people, (c) => {
    expect(labels(c)).not.toContain('Add a co-owner')
    expect(labels(c)).toContain('Invite a member')
  })
})

it('names the invited role on a pending invitation', async () => {
  api.listSpaceInvitations.mockResolvedValue([
    {
      invitation_id: 'i1',
      invitee_id: 'x',
      invitee_first_name: 'Ivy',
      invitee_last_name: 'Ong',
      invitee_avatar_url: null,
      invited_by: 'me',
      created_at: '2026-01-01',
      invited_level: 'member',
      invited_role: 'qa',
    },
  ])
  await renderAs('pm', people, (c) => {
    expect(row(c, 'Ivy').textContent).toContain('QA')
  })
})
