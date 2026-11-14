// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import Accounts from './Accounts'
import { offboardingPreview } from '../../../lib/api/offboarding'
import type { Account } from '../../../lib/types'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const account = (over: Partial<Account>): Account => ({
  id: 'x',
  first_name: 'Zz',
  middle_name: null,
  last_name: 'Person',
  email: 'x@example.com',
  avatar_url: null,
  role: 'member',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  decided_at: null,
  decided_by: null,
  decided_by_name: null,
  class_count: 0,
  enrolment_count: 0,
  can_teach: false,
  can_manage_projects: false,
  bulk_setup_required: false,
  managed_project_count: 0,
  ...over,
})

const ROWS: Account[] = [
  account({ id: 'admin', first_name: 'Ada', last_name: 'Admin', role: 'admin', email: 'ada@example.com' }),
  account({ id: 'other-admin', first_name: 'Oli', last_name: 'Admin', role: 'admin', email: 'oli@example.com' }),
  account({ id: 'stu', first_name: 'Sam', last_name: 'Student', role: 'student', email: 'sam@example.com' }),
  account({ id: 't', first_name: 'Ana', last_name: 'Cruz', email: 'ana@example.com' }),
  account({ id: 's1', first_name: 'Ben', last_name: 'Reyes', email: 'ben@example.com', can_manage_projects: true }),
]

const toast = vi.hoisted(() => vi.fn())
vi.mock('../../../components/ui/Toast', () => ({ useToast: () => ({ show: toast }) }))
vi.mock('../../../hooks/useLive', () => ({ useLive: () => {} }))
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'admin', role: 'admin', status: 'active' }, refreshProfile: vi.fn() }),
}))
vi.mock('../../../lib/api/accounts', () => ({
  listAccounts: vi.fn(async () => ROWS),
  setAccountActive: vi.fn(async () => {}),
  setAccountRole: vi.fn(async () => {}),
  setProjectManager: vi.fn(async () => {}),
  registerBulkUsers: vi.fn(async () => []),
}))
vi.mock('../../../lib/api/admin', () => ({ setCanTeach: vi.fn(async () => {}) }))
vi.mock('../../../lib/api/offices', () => ({
  listOffices: vi.fn(async () => []),
  listOfficePeople: vi.fn(async () => []),
  setMemberOffice: vi.fn(async () => {}),
}))
vi.mock('../../../lib/api/offboarding', () => ({
  offboardingPreview: vi.fn(async () => []),
  offboardMember: vi.fn(async () => {}),
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
      <MemoryRouter initialEntries={['/admin/accounts']}>
        <Accounts />
      </MemoryRouter>,
    ),
  )
}

const text = () => document.body.textContent ?? ''
const rowOf = (name: string) =>
  [...document.querySelectorAll('li')].find((li) => li.textContent?.includes(name))!
const deactivate = (name: string) =>
  [...rowOf(name).querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Deactivate')

async function clickDeactivate(name: string) {
  await act(async () => deactivate(name)!.click())
}

it('a student skips the preview and gets the plain confirmation; an admin has no Deactivate', async () => {
  await render()
  expect(deactivate('Oli Admin')).toBeUndefined()
  await clickDeactivate('Sam Student')
  expect(offboardingPreview).not.toHaveBeenCalled()
  expect(text()).toContain('Deactivate this account?')
  expect(text()).not.toContain('Deactivate and hand over')
})

it('a member who holds nothing gets the plain confirmation', async () => {
  await render()
  await clickDeactivate('Ana Cruz')
  expect(offboardingPreview).toHaveBeenCalledWith('t')
  expect(text()).toContain('Deactivate this account?')
  expect(text()).not.toContain('Offboard Ana Cruz')
})

it('a member who holds something gets the Offboard dialog with eligible successors', async () => {
  vi.mocked(offboardingPreview).mockResolvedValueOnce([
    {
      kind: 'project_pm',
      item_id: 'p1',
      item_name: 'Enrollment 2027',
      project_name: 'Enrollment 2027',
      space_name: 'Registrar Ops',
      office_name: '',
      archived: false,
      task_count: 0,
    },
  ])
  await render()
  await clickDeactivate('Ana Cruz')
  expect(text()).toContain('Offboard Ana Cruz')
  expect(text()).toContain('Deactivate and hand over')
  expect(text()).not.toContain('Deactivate this account?')
  const picker = document.querySelector<HTMLSelectElement>('select[data-offboard-successor]')!
  // Only Ben has Project manager on; Ana, the admins and the student are not offered.
  expect([...picker.options].map((o) => o.textContent)).toEqual(['Choose a person', 'Ben Reyes'])
})

it('a failed preview opens the retry dialog, and Try again runs the preview again', async () => {
  // Supabase rejects with a plain object, not an Error instance.
  vi.mocked(offboardingPreview).mockRejectedValueOnce({ message: 'Only an admin can offboard someone.', code: '42501' })
  await render()
  await clickDeactivate('Ana Cruz')
  expect(text()).toContain('Offboard Ana Cruz')
  expect(text()).toContain('Only an admin can offboard someone.')
  expect(text()).not.toContain('Deactivate this account?')
  const retry = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Try again')!
  await act(async () => retry.click())
  expect(offboardingPreview).toHaveBeenCalledTimes(2)
  expect(text()).toContain('Deactivate this account?')
})
