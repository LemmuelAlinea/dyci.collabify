// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ClassSummary, GroupSet, GroupSummary } from '../../lib/types'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const m = vi.hoisted(() => ({
  data: vi.fn(),
  ungrouped: vi.fn(),
  setClosed: vi.fn(),
  place: vi.fn(),
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'p1', role: 'member' } }) }))
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: () => {} }) }))
vi.mock('../../hooks/useGroupsData', () => ({ useGroupsData: m.data }))
vi.mock('../../lib/api/groups', () => ({
  deleteSet: vi.fn(),
  projectsUsingSet: vi.fn(),
  placeStudent: m.place,
  setClosed: m.setClosed,
  ungroupedStudents: m.ungrouped,
}))
vi.mock('./CreateSetWizard', () => ({ CreateSetWizard: () => null }))
// The board and dialog have their own tests; these stand-ins show what the tab hands them.
vi.mock('./GroupsBoard', () => ({
  GroupsBoard: (p: {
    sets: GroupSet[]
    groups: GroupSummary[]
    emptyTitle: string
    setActions?: (s: GroupSet) => ReactNode
  }) => (
    <div>
      {p.groups.length === 0 && <p>{p.emptyTitle}</p>}
      {p.groups.map((g) => (
        <p key={g.id}>{`group ${g.name}`}</p>
      ))}
      {p.sets.map((s) => (
        <div key={s.id}>{p.setActions?.(s)}</div>
      ))}
    </div>
  ),
}))
vi.mock('../ui/ConfirmDialog', () => ({
  ConfirmDialog: (p: {
    open: boolean
    title: string
    body: ReactNode
    confirmLabel: string
    onConfirm: () => Promise<void>
  }) =>
    p.open ? (
      <div data-dialog={p.title}>
        <h2>{p.title}</h2>
        <div>{p.body}</div>
        <button type="button" data-confirm onClick={() => void p.onConfirm()}>
          {p.confirmLabel}
        </button>
      </div>
    ) : null,
}))

import { ClassGroupsTab } from './ClassGroupsTab'

const cls = { id: 'c1', archived_at: null } as ClassSummary
const set = { id: 's1', name: 'Capstone teams', closed_at: null } as GroupSet
const live = [
  { id: 'g1', set_id: 's1', name: 'Alpha', member_count: 3, member_limit: 4 },
  { id: 'g2', set_id: 's1', name: 'Beta', member_count: 2, member_limit: 4 },
] as GroupSummary[]
const shelved = [{ id: 'g9', set_id: 's1', name: 'Old crew', member_count: 3, member_limit: 4 }] as GroupSummary[]

let el: HTMLDivElement

async function render(role: 'professor' | 'student') {
  el = document.createElement('div')
  document.body.appendChild(el)
  await act(async () => {
    createRoot(el).render(
      <MemoryRouter>
        <ClassGroupsTab cls={cls} role={role} viewerId={role === 'student' ? 'st1' : undefined} />
      </MemoryRouter>,
    )
  })
}

const button = (text: string) =>
  [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement

async function click(b: HTMLElement) {
  await act(async () => {
    b.click()
  })
}

beforeEach(() => {
  m.data.mockImplementation((_ids: unknown, archived = false) => ({
    sets: [set],
    groups: archived ? shelved : live,
    members: [],
    loading: false,
    error: null,
    reload: vi.fn(),
  }))
  m.ungrouped.mockResolvedValue([])
  m.setClosed.mockResolvedValue(undefined)
  m.place.mockResolvedValue(undefined)
})

it('lets a professor switch to the archived groups', async () => {
  await render('professor')
  expect(el.textContent).toContain('group Alpha')
  expect(el.textContent).not.toContain('group Old crew')

  await click(button('Archived'))
  expect(m.data).toHaveBeenLastCalledWith([{ id: 'c1' }], true)
  expect(el.textContent).toContain('group Old crew')
  expect(el.textContent).not.toContain('group Alpha')
  // Sets are run from the live shelf only.
  expect(button('Close set')).toBeUndefined()

  await click(button('Active'))
  expect(el.textContent).toContain('group Alpha')
})

it('gives a student no Archived switch and never asks for archived groups', async () => {
  await render('student')
  expect(button('Archived')).toBeUndefined()
  expect(button('Active')).toBeUndefined()
  expect(button('Close set')).toBeUndefined()
  expect(m.data).toHaveBeenLastCalledWith([{ id: 'c1' }], false)
})

it('offers to place ungrouped students when a professor closes a set', async () => {
  m.ungrouped.mockResolvedValue([
    { student_id: 'st1', first_name: 'Ana', last_name: 'Cruz' },
    { student_id: 'st2', first_name: 'Ben', last_name: 'Diaz' },
  ])
  await render('professor')
  await click(button('Close set'))

  expect(m.ungrouped).toHaveBeenCalledWith('s1')
  expect(m.setClosed).not.toHaveBeenCalled()
  const dialog = el.querySelector('[data-dialog="Close Capstone teams?"]')
  expect(dialog?.textContent).toContain('2 students have no group')
  expect(dialog?.textContent).toContain('Place them in the groups with room, smallest first')
  expect(dialog?.textContent).toContain('Cruz, Ana → Beta')

  await click(el.querySelector('[data-confirm]') as HTMLElement)
  expect(m.place).toHaveBeenCalledTimes(2)
  expect(m.place).toHaveBeenCalledWith({ groupId: 'g2', setId: 's1', studentId: 'st1', byProfessorId: 'p1' })
  expect(m.setClosed).toHaveBeenCalledWith('s1', true)
})

it('closes straight away when everyone already has a group', async () => {
  await render('professor')
  await click(button('Close set'))
  const dialog = el.querySelector('[data-dialog="Close Capstone teams?"]')
  expect(dialog?.textContent).toContain('Everyone in the class has a group')
  expect(button('Close set')).toBeDefined()
})
