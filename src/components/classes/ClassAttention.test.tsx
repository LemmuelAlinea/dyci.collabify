// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ClassSummary } from '../../lib/types'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const m = vi.hoisted(() => ({ counts: vi.fn(), projects: vi.fn(), boards: vi.fn() }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'member' } }) }))
vi.mock('../../hooks/useLive', () => ({ useLive: () => {} }))
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: () => {} }) }))
vi.mock('../../lib/api/waiting', () => ({ teachingWaitingCounts: m.counts }))
vi.mock('../../lib/api/projects', () => ({ listProjectsForClasses: m.projects }))
vi.mock('../../lib/api/dashboard', async () => {
  const { groupsBehind } = await vi.importActual<typeof import('../../lib/api/dashboard')>(
    '../../lib/api/dashboard',
  )
  return { boardsFor: m.boards, groupsBehind }
})
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

import { ClassAttention } from './ClassAttention'

const cls = (student_count: number, archived_at: string | null = null) =>
  ({ id: 'c1', code: 'ABC123', student_count, archived_at }) as ClassSummary

async function render(c: ClassSummary) {
  const el = document.createElement('div')
  await act(async () => {
    createRoot(el).render(
      <MemoryRouter>
        <ClassAttention cls={c} />
      </MemoryRouter>,
    )
  })
  return el.textContent ?? ''
}

beforeEach(() => {
  m.counts.mockResolvedValue({ handIns: 3, requests: 1 })
  m.projects.mockResolvedValue([])
  m.boards.mockResolvedValue([])
})

it('shows the next steps in a class with no students and no projects', async () => {
  const text = await render(cls(0))
  expect(text).toContain('Add your students')
  expect(text).toContain('Set your first project')
  expect(text).not.toContain('Waiting on you here')
})

it('shows the two tiles once a student has joined', async () => {
  const text = await render(cls(1))
  expect(text).not.toContain('Add your students')
  expect(text).toContain('Waiting on you here')
  expect(text).toContain('3hand-ins to answer')
  expect(text).toContain('1reassignment to decide')
  expect(text).toContain('Nothing is behind')
})

it('shows the two tiles once a project exists', async () => {
  m.projects.mockResolvedValue([{ id: 'p1', archived_at: null }])
  const text = await render(cls(0))
  expect(text).not.toContain('Add your students')
  expect(text).toContain('Groups behind')
  expect(m.boards).toHaveBeenCalledWith(['p1'])
})

it('lists groups behind, each opening its board', async () => {
  m.projects.mockResolvedValue([{ id: 'p1', archived_at: null }])
  m.boards.mockResolvedValue([
    {
      id: 'b1', project_id: 'p1', group_id: 'g1', group_name: 'Group 4', project_title: 'Inventory',
      task_count: 4, done_count: 1, done_pct: 25, late_count: 2, last_activity: new Date().toISOString(),
    },
  ])
  const el = document.createElement('div')
  await act(async () => {
    createRoot(el).render(
      <MemoryRouter>
        <ClassAttention cls={cls(5)} />
      </MemoryRouter>,
    )
  })
  expect(el.textContent).toContain('Group 4')
  expect(el.textContent).toContain('2 late tasks')
  expect(el.querySelector('a[href="/class-projects/p1/boards/b1"]')).not.toBeNull()
})
