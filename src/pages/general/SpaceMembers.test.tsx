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

const workload = vi.hoisted(() => ({
  setSpaceWeeklyMinutes: vi.fn(),
  spacePeopleHours: vi.fn(),
  spaceDefaultWeeklyMinutes: vi.fn(),
  setSpaceDefaultWeeklyMinutes: vi.fn(),
}))
vi.mock('../../lib/api/workload', () => workload)

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
  workload.spacePeopleHours.mockResolvedValue([])
  workload.setSpaceWeeklyMinutes.mockResolvedValue(undefined)
  workload.spaceDefaultWeeklyMinutes.mockResolvedValue(2400)
  workload.setSpaceDefaultWeeklyMinutes.mockResolvedValue(undefined)
})

afterEach(() => {
  document.body.innerHTML = ''
})

async function renderAs(
  role: string,
  members: ReturnType<typeof person>[],
  check: (c: HTMLElement) => void | Promise<void>,
  spaceOverrides: Record<string, unknown> = {},
) {
  space = {
    id: 's',
    name: 'Capstone',
    kind: 'work',
    class_id: null,
    archived_at: null,
    my_role: role,
    ...spaceOverrides,
  }
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
      const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!
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

// A null own value is someone on the space's 40 h default.
const hours = (user_id: string, own: number | null) => ({
  user_id,
  weekly_minutes: own ?? 2400,
  own_weekly_minutes: own,
  available_minutes: own ?? 2400,
  time_off_minutes: 0,
})
const hoursInput = (el: Element) => el.querySelector<HTMLInputElement>('input[aria-label^="Weekly hours"]')
const typeInto = (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

it('shows weekly hours or the default on a work space', async () => {
  workload.spacePeopleHours.mockResolvedValue([hours('me', 960), hours('m1', null), hours('c1', 600)])
  await renderAs('member', [person('me', 'Me', 'member'), people[1], people[2]], (c) => {
    expect(c.textContent).toContain('Weekly hours')
    expect(row(c, 'Cora').textContent).toContain('10 h')
    expect(row(c, 'Mia').textContent).toContain('40 h (default)')
    expect(c.textContent).not.toContain('Not set')
    expect(c.textContent).toContain('Default weekly hours: 40 h')
    expect(c.querySelector('input[aria-label="Default weekly hours"]')).toBeNull()
    expect(workload.spacePeopleHours).toHaveBeenCalledWith('s', expect.any(String), expect.any(String))
  })
})

it('lets the project manager edit every row and saves minutes', async () => {
  workload.spacePeopleHours.mockResolvedValue([hours('me', 960), hours('m1', null)])
  await renderAs('pm', people, async (c) => {
    for (const name of ['Me', 'Cora', 'Mia', 'Stu']) expect(hoursInput(row(c, name))).not.toBeNull()
    expect(hoursInput(row(c, 'Me'))!.value).toBe('16')
    expect(hoursInput(row(c, 'Mia'))!.value).toBe('')
    expect(hoursInput(row(c, 'Mia'))!.placeholder).toBe('40 (default)')
    await typeInto(hoursInput(row(c, 'Mia'))!, '16')
    await act(async () => button('Save hours', row(c, 'Mia')).click())
    expect(workload.setSpaceWeeklyMinutes).toHaveBeenCalledWith('s', 'm1', 960)
  })
})

it('lets a planner change the space default', async () => {
  workload.spacePeopleHours.mockResolvedValue([hours('me', 960), hours('m1', null)])
  await renderAs('coordinator', [person('me', 'Me', 'coordinator'), people[2]], async (c) => {
    const input = c.querySelector<HTMLInputElement>('input[aria-label="Default weekly hours"]')!
    expect(input.value).toBe('40')
    await typeInto(input, '30')
    await act(async () => button('Save default').click())
    expect(workload.setSpaceDefaultWeeklyMinutes).toHaveBeenCalledWith('s', 1800)
    expect(show).toHaveBeenCalledWith('Default weekly hours saved')
  })
})

it('shows a dash and says so when weekly hours fail to load', async () => {
  workload.spacePeopleHours.mockRejectedValue(new Error('offline'))
  await renderAs('pm', people, (c) => {
    expect(hoursInput(row(c, 'Mia'))).toBeNull()
    expect(row(c, 'Mia').textContent).toContain('—')
    expect(c.textContent).not.toContain('(default)')
    expect(c.textContent).toContain('Could not load weekly hours. Reload the page to try again.')
  })
})

it('refuses an empty space default', async () => {
  await renderAs('pm', people, async (c) => {
    const input = c.querySelector<HTMLInputElement>('input[aria-label="Default weekly hours"]')!
    await typeInto(input, '')
    await act(async () => button('Save default').click())
    expect(workload.setSpaceDefaultWeeklyMinutes).not.toHaveBeenCalled()
    expect(show).toHaveBeenCalledWith('Enter the default weekly hours, from 0 to 168.', 'error')
  })
})

it('lets a coordinator edit every row', async () => {
  await renderAs('coordinator', [person('me', 'Me', 'coordinator'), people[2]], (c) => {
    expect(hoursInput(row(c, 'Me'))).not.toBeNull()
    expect(hoursInput(row(c, 'Mia'))).not.toBeNull()
  })
})

it('lets a member edit only their own row', async () => {
  await renderAs('member', [person('me', 'Me', 'member'), people[2]], (c) => {
    expect(hoursInput(row(c, 'Me'))).not.toBeNull()
    expect(hoursInput(row(c, 'Mia'))).toBeNull()
  })
})

it('clears weekly hours when the field is emptied', async () => {
  workload.spacePeopleHours.mockResolvedValue([hours('me', 960)])
  await renderAs('pm', people, async (c) => {
    await typeInto(hoursInput(row(c, 'Me'))!, '')
    await act(async () => button('Save hours', row(c, 'Me')).click())
    expect(workload.setSpaceWeeklyMinutes).toHaveBeenCalledWith('s', 'me', null)
  })
})

it('shows no weekly hours on a class space', async () => {
  await renderAs(
    'pm',
    people,
    (c) => {
      expect(c.textContent).not.toContain('Weekly hours')
      expect(workload.spacePeopleHours).not.toHaveBeenCalled()
    },
    { kind: 'education', class_id: 'k1' },
  )
})

it('refuses weekly hours that are not a number and keeps the saved value', async () => {
  workload.spacePeopleHours.mockResolvedValue([hours('me', 960)])
  await renderAs('pm', people, async (c) => {
    await typeInto(hoursInput(row(c, 'Me'))!, 'abc')
    await act(async () => button('Save hours', row(c, 'Me')).click())
    expect(workload.setSpaceWeeklyMinutes).not.toHaveBeenCalled()
    expect(show).toHaveBeenCalledWith('Enter weekly hours as a number, like 16 or 12.5.', 'error')
  })
})

it('refuses more than 168 weekly hours', async () => {
  await renderAs('pm', people, async (c) => {
    await typeInto(hoursInput(row(c, 'Mia'))!, '169')
    await act(async () => button('Save hours', row(c, 'Mia')).click())
    expect(workload.setSpaceWeeklyMinutes).not.toHaveBeenCalled()
    expect(show).toHaveBeenCalledWith('Enter weekly hours up to 168.', 'error')
  })
})

it('saves 0 weekly hours as 0, not as Not set', async () => {
  await renderAs('pm', people, async (c) => {
    await typeInto(hoursInput(row(c, 'Mia'))!, '0')
    await act(async () => button('Save hours', row(c, 'Mia')).click())
    expect(workload.setSpaceWeeklyMinutes).toHaveBeenCalledWith('s', 'm1', 0)
  })
})
