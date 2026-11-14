// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import AdminHome from './AdminHome'
import { attentionProjects, orgOverview, orgSummary } from '../../lib/api/offices'
import { assignSpacePm, spacesWithoutPm } from '../../lib/api/offboarding'
import { programClasses } from '../../lib/api/admin'
import type { ProgramClass } from '../../lib/program'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'me', first_name: 'Rhea' } }),
}))
const toast = vi.hoisted(() => vi.fn())
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ show: toast }) }))
vi.mock('../../lib/api/offboarding', () => ({
  spacesWithoutPm: vi.fn(async () => []),
  assignSpacePm: vi.fn(async () => {}),
}))
vi.mock('../../lib/api/accounts', () => ({
  listAccounts: vi.fn(async () => [
    { id: 'a1', first_name: 'Ben', middle_name: null, last_name: 'Reyes', email: 'b@x', role: 'member', status: 'active', can_manage_projects: true },
    { id: 'a2', first_name: 'Cara', middle_name: null, last_name: 'Lim', email: 'c@x', role: 'member', status: 'active', can_manage_projects: false },
  ]),
}))
vi.mock('../../lib/api/offices', () => ({
  orgOverview: vi.fn(async () => [
    { office_id: null, office_name: '', spaces: 1, running_projects: 1, people: 2, needs_attention: 0 },
    { office_id: 'o2', office_name: 'Registrar', spaces: 1, running_projects: 2, people: 3, needs_attention: 1 },
    { office_id: 'o1', office_name: 'IT services', spaces: 2, running_projects: 4, people: 5, needs_attention: 1 },
  ]),
  attentionProjects: vi.fn(async () => [
    {
      project_id: 'p1',
      project_name: 'Helpdesk revamp',
      space_name: 'Helpdesk',
      office_id: 'o1',
      office_name: 'IT services',
      no_pm: true,
      quiet_since: null,
    },
    {
      project_id: 'p2',
      project_name: 'Records cleanup',
      space_name: 'Records',
      office_id: 'o2',
      office_name: 'Registrar',
      no_pm: false,
      quiet_since: '2026-10-28T03:00:00Z',
    },
  ]),
  orgSummary: vi.fn(async () => ({ accounts_in_setup: 0, privacy_due: 3 })),
}))

const cls = (over: Partial<ProgramClass>): ProgramClass => ({
  class_id: 'c1',
  class_initial: 'IT 101',
  class_name: 'Intro to computing',
  code: 'A1',
  section: 'BSIT 1A',
  year_level: '1st',
  semester: '1st',
  school_year: '2026-2027',
  professor_id: 'f1',
  professor_name: 'Dr. Santos',
  term_start: '2026-08-01',
  term_end: '2026-12-15',
  archived_at: null,
  has_syllabus: true,
  weeks_total: 16,
  weeks_covered: 10,
  weeks_elapsed: 10,
  weeks_in_term: 16,
  students: 30,
  projects: 2,
  projects_released: 1,
  boards: 2,
  tasks: 10,
  tasks_done: 5,
  tasks_late: 0,
  last_activity: null,
  ...over,
})

vi.mock('../../lib/api/admin', () => ({
  programClasses: vi.fn(async () => [
    cls({ class_id: 'c1', class_initial: 'IT 101', term_start: null, term_end: null }),
    cls({ class_id: 'c2', class_initial: 'IT 202', weeks_covered: 4, weeks_elapsed: 9 }),
    cls({ class_id: 'c3', class_initial: 'IT 303' }),
  ]),
}))

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = null
  root = null
  vi.clearAllMocks()
})

async function render() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <MemoryRouter initialEntries={['/home']}>
        <AdminHome />
      </MemoryRouter>,
    ),
  )
}

const band = (name: string) => document.querySelector(`[data-home-band="${name}"]`)
const officeRows = () => [...document.querySelectorAll('[data-office-row]')]

it('renders an office row per office with Unassigned last', async () => {
  await render()
  const rows = officeRows()
  expect(rows.map((r) => r.querySelector('[data-office-name]')?.textContent)).toEqual([
    'IT services',
    'Registrar',
    'Unassigned',
  ])
  expect(rows.map((r) => r.getAttribute('href'))).toEqual([
    '/admin/offices?office=o1',
    '/admin/offices?office=o2',
    '/admin/offices?office=unassigned',
  ])
  expect(rows[0].textContent).toContain('4')
  expect(rows[0].textContent).toContain('5')
})

it('names why a project needs attention', async () => {
  await render()
  const lines = [...band('attention')!.querySelectorAll('li')]
  expect(lines).toHaveLength(2)
  expect(lines[0].textContent).toContain('Helpdesk revamp')
  expect(lines[0].textContent).toContain('Helpdesk')
  expect(lines[0].textContent).toContain('IT services')
  expect(lines[0].textContent).toContain('No project manager')
  expect(lines[0].querySelector('a')?.getAttribute('href')).toBe('/admin/projects?assign=p1')
  expect(lines[1].textContent).toContain('Quiet since')
  expect(lines[1].querySelector('a')).toBeNull()
})

it('calls a project with no office Unassigned', async () => {
  vi.mocked(attentionProjects).mockResolvedValueOnce([
    {
      project_id: 'p9',
      project_name: 'Loose ends',
      space_name: 'Loose space',
      office_id: null,
      office_name: '',
      no_pm: true,
      quiet_since: null,
    },
  ])
  await render()
  const line = band('attention')!.querySelector('li')!
  expect(line.textContent).toContain('Loose space · Unassigned')
  expect(line.textContent).not.toContain('No office')
})

it('shows the first six projects that need attention, then how many more', async () => {
  vi.mocked(attentionProjects).mockResolvedValueOnce(
    Array.from({ length: 8 }, (_, i) => ({
      project_id: `p${i}`,
      project_name: `Project ${i}`,
      space_name: 'Helpdesk',
      office_id: 'o1',
      office_name: 'IT services',
      no_pm: false,
      quiet_since: '2026-10-28T03:00:00Z',
    })),
  )
  await render()
  const attention = band('attention')!
  expect(attention.querySelectorAll('li')).toHaveLength(6)
  expect(attention.textContent).not.toContain('Project 6')
  const more = attention.querySelector('[data-attention-more]')!
  expect(more.textContent).toBe('2 more')
  expect(more.getAttribute('href')).toBe('/admin/projects')
})

it('says notices reach professors and students', async () => {
  await render()
  expect(document.body.textContent).toContain(
    'Program-wide notices that reach every professor and student in one send.',
  )
  expect(document.body.textContent).not.toContain('members, faculty and students')
})

it('says so when nothing needs attention', async () => {
  vi.mocked(attentionProjects).mockResolvedValueOnce([])
  await render()
  expect(band('attention')!.textContent).toContain(
    'Every running project has a project manager and recent activity.',
  )
})

it('shows a retry for a failed overview while the other bands still render', async () => {
  vi.mocked(orgOverview).mockRejectedValueOnce(new Error('offline'))
  await render()
  const alert = band('offices')!.querySelector('[role="alert"]')
  expect(alert?.textContent).toContain('Try again')
  expect(officeRows()).toHaveLength(0)
  expect(band('attention')!.querySelectorAll('li')).toHaveLength(2)
  expect(band('setup')!.textContent).toContain('Accounts in setup')
  expect(band('program')).not.toBeNull()

  const retry = [...alert!.querySelectorAll('button')].find((b) => b.textContent === 'Try again')!
  await act(async () => retry.click())
  expect(orgOverview).toHaveBeenCalledTimes(2)
  expect(officeRows()).toHaveLength(3)
})

it('hides the academic band with no classes', async () => {
  vi.mocked(programClasses).mockResolvedValueOnce([])
  await render()
  expect(band('program')).toBeNull()
  expect(band('offices')).not.toBeNull()
})

it('counts classes that cannot start and classes behind', async () => {
  await render()
  const program = band('program')!
  expect(program.querySelector('[data-program="not-ready"] [data-count]')?.textContent).toBe('1')
  expect(program.querySelector('[data-program="not-ready"]')?.textContent).toContain('IT 101')
  expect(program.querySelector('[data-program="behind"] [data-count]')?.textContent).toBe('1')
  expect(program.querySelector('[data-program="behind"]')?.textContent).toContain('IT 202')
  expect(program.querySelector('a[href="/admin/classes"]')).not.toBeNull()
})

it('leaves ended classes and other school years out of the academic band', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-14T02:00:00Z'))
  try {
    vi.mocked(programClasses).mockResolvedValueOnce([
      cls({ class_id: 'c1', class_initial: 'IT 101', term_start: null, term_end: null }),
      cls({ class_id: 'c2', class_initial: 'IT 202', weeks_covered: 4, weeks_elapsed: 9 }),
      cls({ class_id: 'c3', class_initial: 'IT 303' }),
      // Ended last month, never archived: weeks_elapsed keeps growing.
      cls({
        class_id: 'c4',
        class_initial: 'IT 404',
        term_start: '2026-06-01',
        term_end: '2026-10-01',
        weeks_covered: 10,
        weeks_elapsed: 23,
      }),
      // Last school year, still running by its dates and not ready.
      cls({
        class_id: 'c5',
        class_initial: 'IT 505',
        school_year: '2025-2026',
        term_start: null,
        term_end: null,
        weeks_covered: 1,
        weeks_elapsed: 30,
      }),
    ])
    await render()
    const program = band('program')!
    const notReady = program.querySelector('[data-program="not-ready"]')!
    const behind = program.querySelector('[data-program="behind"]')!
    expect(notReady.querySelector('[data-count]')?.textContent).toBe('1')
    expect(behind.querySelector('[data-count]')?.textContent).toBe('1')
    expect(program.textContent).not.toContain('IT 404')
    expect(program.textContent).not.toContain('IT 505')
  } finally {
    vi.useRealTimers()
  }
})

it('shows zero accounts in setup as 0', async () => {
  await render()
  const accounts = band('setup')!.querySelector('a[href="/admin/accounts"]')!
  expect(accounts.querySelector('[data-count]')?.textContent).toBe('0')
  const privacy = band('setup')!.querySelector('a[href="/admin/privacy"]')!
  expect(privacy.querySelector('[data-count]')?.textContent).toBe('3')
  expect(orgSummary).toHaveBeenCalledTimes(1)
})

const STUCK = [{ space_id: 's1', space_name: 'Helpdesk space', office_name: 'IT services' }]
const assignButton = () =>
  [...band('attention')!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Assign')!
const saveButton = () =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Assign project manager')!

async function pick(value: string) {
  const select = document.querySelector<HTMLSelectElement>('select[data-space-pm]')!
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  return select
}

it('lists a space without a project manager with an Assign button', async () => {
  vi.mocked(spacesWithoutPm).mockResolvedValueOnce(STUCK)
  await render()
  const lines = [...band('attention')!.querySelectorAll('li')]
  expect(lines).toHaveLength(3)
  expect(lines[0].textContent).toContain('Helpdesk space')
  expect(lines[0].textContent).toContain('IT services')
  expect(lines[0].textContent).toContain('Space has no project manager')
  expect(lines[0].querySelector('button')?.textContent).toBe('Assign')
  expect(lines[1].textContent).toContain('Helpdesk revamp')
})

it('counts space lines toward the cap of six', async () => {
  vi.mocked(spacesWithoutPm).mockResolvedValueOnce(STUCK)
  vi.mocked(attentionProjects).mockResolvedValueOnce(
    Array.from({ length: 6 }, (_, i) => ({
      project_id: `p${i}`,
      project_name: `Project ${i}`,
      space_name: 'Helpdesk',
      office_id: 'o1',
      office_name: 'IT services',
      no_pm: false,
      quiet_since: '2026-10-28T03:00:00Z',
    })),
  )
  await render()
  const attention = band('attention')!
  expect(attention.querySelectorAll('li')).toHaveLength(6)
  expect(attention.querySelector('[data-attention-more]')?.textContent).toBe('1 more')
})

it('assigning calls assignSpacePm and reloads', async () => {
  vi.mocked(spacesWithoutPm).mockResolvedValueOnce(STUCK)
  await render()
  await act(async () => assignButton().click())
  const select = document.querySelector<HTMLSelectElement>('select[data-space-pm]')!
  // Only Ben has Project manager on.
  expect([...select.options].map((o) => o.textContent)).toEqual(['Choose a person', 'Ben Reyes'])
  expect(saveButton().disabled).toBe(true)
  await pick('a1')
  await act(async () => saveButton().click())
  expect(assignSpacePm).toHaveBeenCalledWith('s1', 'a1')
  expect(toast).toHaveBeenCalled()
  expect(spacesWithoutPm).toHaveBeenCalledTimes(2)
})

it("shows the database's refusal in the space dialog", async () => {
  vi.mocked(spacesWithoutPm).mockResolvedValueOnce(STUCK)
  vi.mocked(assignSpacePm).mockRejectedValueOnce({ message: 'Ben Reyes needs Project manager on.', code: 'P0001' })
  await render()
  await act(async () => assignButton().click())
  await pick('a1')
  await act(async () => saveButton().click())
  expect(document.body.textContent).toContain('Ben Reyes needs Project manager on.')
  expect(toast).not.toHaveBeenCalled()
})
