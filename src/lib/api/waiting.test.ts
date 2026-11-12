import { beforeEach, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  classes: vi.fn(),
  projects: vi.fn(),
  boards: vi.fn(),
  requests: vi.fn(),
}))
vi.mock('./classes', () => ({ listProfessorClasses: m.classes }))
vi.mock('./projects', () => ({ listProjectsForClasses: m.projects }))
vi.mock('./results', () => ({ listHandedInBoards: m.boards }))
vi.mock('./reassignments', () => ({ listReassignments: m.requests }))
vi.mock('../submissions', () => ({
  toSubmissions: (boards: unknown[]) => boards,
  submissionStatus: (b: { waiting: boolean }) => (b.waiting ? 'waiting' : 'accepted'),
}))

import { teachingWaitingCount } from './waiting'

beforeEach(() => {
  m.classes.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
  m.projects.mockImplementation(async (ids: string[]) =>
    ids.map((c) => ({ id: `p-${c}`, archived_at: null })),
  )
  m.boards.mockImplementation(async (ids: string[]) =>
    ids.flatMap((id) => [{ id, waiting: true }, { id: `${id}-x`, waiting: false }]),
  )
  m.requests.mockResolvedValue([
    { class_id: 'a', status: 'pending' },
    { class_id: 'b', status: 'pending' },
    { class_id: 'b', status: 'approved' },
  ])
})

it('counts waiting hand-ins and pending requests across classes', async () => {
  expect(await teachingWaitingCount('u')).toBe(2 + 2)
})

it('narrows to one class when given its id', async () => {
  expect(await teachingWaitingCount('u', 'b')).toBe(1 + 1)
  expect(m.projects).toHaveBeenLastCalledWith(['b'])
})
