// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { LiveGroupSet } from '../../lib/api/groups'
import type { ClassSummary, ClassWeek, GroupSet, ProjectSummary } from '../../lib/types'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const m = vi.hoisted(() => ({
  sets: [] as unknown[],
  nextSet: null as unknown,
  show: vi.fn(),
  listLiveSets: vi.fn(),
  projectsUsingSet: vi.fn(),
  deleteSet: vi.fn(),
  listProfessorClasses: vi.fn(),
  setProjectAudience: vi.fn(),
  updateProjectSeries: vi.fn(),
  createProjectSeries: vi.fn(),
}))

vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: m.show }) }))
// The dialog chrome is not under test; this renders its body and buttons in place.
vi.mock('../ui/Modal', () => ({
  Modal: (p: { open: boolean; children: ReactNode; footer?: ReactNode }) =>
    p.open ? (
      <div>
        {p.children}
        {p.footer}
      </div>
    ) : null,
}))
// A stand-in group maker: shows which class it was opened for, and "makes" m.nextSet.
vi.mock('../groups/CreateSetWizard', () => ({
  CreateSetWizard: (p: {
    open: boolean
    fixedClassId?: string
    onClose: () => void
    onCreated: (set: GroupSet) => Promise<void> | void
  }) =>
    p.open ? (
      <div data-maker={p.fixedClassId}>
        <button
          type="button"
          onClick={() => {
            p.onClose()
            void p.onCreated(m.nextSet as GroupSet)
          }}
        >
          stub make
        </button>
      </div>
    ) : null,
}))
vi.mock('../../lib/api/groups', () => ({
  listLiveSets: m.listLiveSets,
  projectsUsingSet: m.projectsUsingSet,
  deleteSet: m.deleteSet,
}))
vi.mock('../../lib/api/classes', () => ({ listProfessorClasses: m.listProfessorClasses }))
vi.mock('../../lib/api/syllabus', () => ({ classWeekMap: vi.fn(async () => weeks) }))
vi.mock('../../lib/api/projects', () => ({
  createProjectSeries: m.createProjectSeries,
  listSeriesMembers: vi.fn(async () => []),
  setProjectAudience: m.setProjectAudience,
  updateProjectSeries: m.updateProjectSeries,
  uploadProjectFile: vi.fn(),
  draftProject: vi.fn(),
  getProjectStages: vi.fn(async () => null),
}))

import { ProjectWizard } from './ProjectWizard'

const week = (n: number): ClassWeek => ({
  class_id: 'c1',
  syllabus_id: 'syl',
  week_id: `w${n}`,
  week_no: n,
  title: `Week ${n}`,
  topics: '',
  outcomes: '',
  assessments: '',
  notes: null,
  term_start: null,
  term_end: null,
  offset_days: 0,
  week_start: null,
  week_end: null,
  phase: n === 1 ? 'current' : 'upcoming',
})
const weeks = [week(1), week(2)]

const course = { initial: 'IT 301', name: 'Capstone', semester: '1st', school_year: '2026-2027' }
const main = { ...course, id: 'c1', section: 'A', syllabus_id: 'syl', student_count: 30 } as unknown as ClassSummary
const other = { ...course, id: 'c2', section: 'B', syllabus_id: 'syl', student_count: 28 } as unknown as ClassSummary

const live = (id: string, classId: string): LiveGroupSet =>
  ({
    id,
    class_id: classId,
    name: `Set ${id}`,
    mode: 'random',
    default_limit: 5,
    closed_at: null,
    created_at: '',
    updated_at: '',
    group_count: 4,
    member_count: 20,
  }) as LiveGroupSet

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
const onClose = vi.fn()
const onSaved = vi.fn()

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  m.sets = []
  m.listLiveSets.mockImplementation(async (ids: string[]) =>
    (m.sets as LiveGroupSet[]).filter((s) => ids.includes(s.class_id)),
  )
  m.listProfessorClasses.mockResolvedValue([main, other])
  m.deleteSet.mockResolvedValue(undefined)
  m.setProjectAudience.mockResolvedValue(undefined)
  m.updateProjectSeries.mockResolvedValue(undefined)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }
}

async function render(editing?: ProjectSummary) {
  await act(async () =>
    root.render(
      <MemoryRouter>
        <ProjectWizard
          open
          onClose={onClose}
          classes={[main]}
          fixedClassId="c1"
          createdBy="prof"
          editing={editing}
          editingCriteria={editing ? [{ label: 'Quality', description: '', max_points: 100 }] : undefined}
          onSaved={onSaved}
        />
      </MemoryRouter>,
    ),
  )
  await flush()
}

const buttons = (text: string) =>
  [...host.querySelectorAll('button')].filter((b) => b.textContent?.trim() === text)

async function click(b: HTMLElement) {
  await act(async () => {
    b.click()
  })
  await flush()
}

/** The select whose placeholder option reads `placeholder`. */
const selectWith = (placeholder: string) =>
  [...host.querySelectorAll('select')].find((s) => s.options[0]?.text === placeholder)!

/** Makes a set through the stand-in, after the given "Make groups now" button. */
async function make(button: HTMLElement, set: LiveGroupSet) {
  await click(button)
  m.sets = [...m.sets, set]
  m.nextSet = set
  await click(buttons('stub make')[0])
}

it('offers to make groups where the dead end used to be, and selects them for each class', async () => {
  await render()
  await click([...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('One group'))!)

  expect(host.textContent).not.toContain('no groups to assign to')
  expect(host.textContent).toContain('This class has no groups yet.')
  expect(buttons('Make groups now')).toHaveLength(1)

  // The main class.
  await click(buttons('Make groups now')[0])
  expect(host.querySelector('[data-maker]')?.getAttribute('data-maker')).toBe('c1')
  m.sets = [live('s-main', 'c1')]
  m.nextSet = live('s-main', 'c1')
  await click(buttons('stub make')[0])
  expect(selectWith('Pick a set of groups').value).toBe('s-main')

  // A second section with no set: tickable, and its row offers the same button.
  const row = [...host.querySelectorAll('button[aria-pressed]')].find((b) =>
    b.textContent?.includes('no groups yet'),
  ) as HTMLButtonElement
  expect(row.disabled).toBe(false)
  await click(row)
  expect(host.textContent).toContain('This section has no groups yet.')
  const rowButton = buttons('Make groups now').at(-1)!
  await click(rowButton)
  expect(host.querySelector('[data-maker]')?.getAttribute('data-maker')).toBe('c2')
  m.sets = [...m.sets, live('s-sec', 'c2')]
  m.nextSet = live('s-sec', 'c2')
  await click(buttons('stub make')[0])
  expect(selectWith("Pick this section's groups").value).toBe('s-sec')
  // The main class keeps its own.
  expect(selectWith('Pick a set of groups').value).toBe('s-main')

  // Cancelling takes back only what no project uses.
  m.projectsUsingSet.mockImplementation(async (id: string) => (id === 's-main' ? 0 : 1))
  await click(buttons('Cancel')[0])
  expect(onClose).toHaveBeenCalled()
  expect(m.projectsUsingSet.mock.calls.map((c) => c[0])).toEqual(['s-main', 's-sec'])
  expect(m.deleteSet).toHaveBeenCalledTimes(1)
  expect(m.deleteSet).toHaveBeenCalledWith('s-main')
  expect(m.show).toHaveBeenCalledWith('Groups made for this project were removed.')
})

const editing = {
  id: 'p1',
  class_id: 'c1',
  series_id: null,
  title: 'Capstone proposal',
  type: 'activity',
  type_label: null,
  guidelines: 'Write the proposal.',
  start_week: 1,
  end_week: 2,
  audience: 'group',
  group_set_id: 's-old',
  total_points: 100,
  due_at: null,
  release_at: null,
  stages: null,
  attachment_count: 0,
} as unknown as ProjectSummary

it('leaves a set that existed before the wizard opened when an edit is cancelled', async () => {
  m.sets = [live('s-old', 'c1')]
  await render(editing)
  expect(selectWith('Pick a set of groups').value).toBe('s-old')

  await make(buttons('Make groups now')[0], live('s-new', 'c1'))
  expect(selectWith('Pick a set of groups').value).toBe('s-new')

  m.projectsUsingSet.mockResolvedValue(0)
  await click(buttons('Cancel')[0])
  expect(m.projectsUsingSet.mock.calls.map((c) => c[0])).toEqual(['s-new'])
  expect(m.deleteSet).toHaveBeenCalledWith('s-new')
  expect(m.deleteSet).not.toHaveBeenCalledWith('s-old')
  expect(m.show).toHaveBeenCalledWith('Groups made for this project were removed.')
})

it('keeps the groups made here once the project saves', async () => {
  m.sets = [live('s-old', 'c1')]
  await render(editing)
  await make(buttons('Make groups now')[0], live('s-new', 'c1'))

  const form = host.querySelector('form')!
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  await flush()
  expect(m.setProjectAudience).toHaveBeenCalledWith('p1', 'group', 's-new')
  expect(onSaved).toHaveBeenCalledWith('p1')

  // A later close finds nothing of its own to take back.
  await click(buttons('Cancel')[0])
  expect(m.projectsUsingSet).not.toHaveBeenCalled()
  expect(m.deleteSet).not.toHaveBeenCalled()
  expect(m.show).not.toHaveBeenCalled()
})

it('removes nothing and says nothing when no groups were made', async () => {
  m.sets = [live('s-old', 'c1')]
  await render(editing)
  await click(buttons('Cancel')[0])
  expect(onClose).toHaveBeenCalled()
  expect(m.projectsUsingSet).not.toHaveBeenCalled()
  expect(m.show).not.toHaveBeenCalled()
})
