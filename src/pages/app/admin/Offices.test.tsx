// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import Offices from './Offices'
import { archiveOffice, listOffices, setMemberOffice } from '../../../lib/api/offices'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const toast = vi.hoisted(() => vi.fn())
vi.mock('../../../components/ui/Toast', () => ({ useToast: () => ({ show: toast }) }))
vi.mock('../../../hooks/useLive', () => ({ useLive: () => {} }))
vi.mock('../../../lib/api/offices', () => ({
  listOffices: vi.fn(async () => [
    { id: 'o2', name: 'Registrar', description: 'Records and enrolment', archived_at: null },
    { id: 'o1', name: 'IT services', description: 'Systems and support', archived_at: null },
    { id: 'o3', name: 'Old desk', description: '', archived_at: '2026-10-01T00:00:00Z' },
  ]),
  listOfficePeople: vi.fn(async () => [
    { id: 'p1', name: 'Ana Cruz', email: 'ana@example.com', status: 'active', office_id: 'o1' },
    { id: 'p2', name: 'Ben Reyes', email: 'ben@example.com', status: 'pending', office_id: null },
    { id: 'p3', name: 'Cara Lim', email: 'cara@example.com', status: 'active', office_id: 'o3' },
  ]),
  listOfficeSpaces: vi.fn(async () => [
    { id: 's1', name: 'Helpdesk', office_id: 'o1', archived: false, running_projects: 2 },
    { id: 's2', name: 'Retired space', office_id: 'o1', archived: true, running_projects: 0 },
    { id: 's3', name: 'Loose space', office_id: null, archived: false, running_projects: 1 },
  ]),
  createOffice: vi.fn(async () => {}),
  renameOffice: vi.fn(async () => {}),
  archiveOffice: vi.fn(async () => {}),
  setMemberOffice: vi.fn(async () => {}),
  setSpaceOffice: vi.fn(async () => {}),
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

async function renderAt(url: string) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <MemoryRouter initialEntries={[url]}>
        <Offices />
      </MemoryRouter>,
    ),
  )
}

const listNames = () =>
  [...document.querySelectorAll('[aria-label="Offices"] button')].map(
    (b) => b.querySelector('[data-office-name]')?.textContent,
  )
const detail = () => document.querySelector('[data-office-detail]')?.textContent ?? ''
const button = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
const choose = (select: HTMLSelectElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })

it('lists offices with Unassigned last', async () => {
  await renderAt('/admin/offices')
  expect(listNames()).toEqual(['IT services', 'Registrar', 'Unassigned'])
  const first = document.querySelector('[aria-label="Offices"] button')!
  // Active people and live spaces only.
  expect(first.textContent).toContain('1 person')
  expect(first.textContent).toContain('1 space')
})

it('selecting an office from ?office= shows its people and spaces', async () => {
  await renderAt('/admin/offices?office=o1')
  expect(detail()).toContain('Ana Cruz')
  expect(detail()).toContain('Helpdesk')
  expect(detail()).not.toContain('Retired space')
  expect(detail()).not.toContain('Ben Reyes')

  await act(async () => root!.unmount())
  host!.remove()
  root = null

  await renderAt('/admin/offices?office=unassigned')
  expect(detail()).toContain('Ben Reyes')
  expect(detail()).toContain('Not active yet')
  // Filed under an archived office counts as Unassigned.
  expect(detail()).toContain('Cara Lim')
  expect(detail()).toContain('Loose space')
  expect(detail()).not.toContain('Ana Cruz')
})

it('Move to calls setMemberOffice with the chosen office', async () => {
  await renderAt('/admin/offices?office=o1')
  const select = document.querySelector<HTMLSelectElement>('select[aria-label="Move Ana Cruz to"]')!
  const offered = [...select.options].map((o) => o.textContent)
  expect(offered).toEqual(['IT services', 'Registrar', 'No office'])
  await choose(select, 'o2')
  expect(setMemberOffice).toHaveBeenCalledWith('p1', 'o2')
  expect(toast).toHaveBeenCalledWith('Ana Cruz moved to Registrar')
})

it('an archive refusal shows the database message', async () => {
  vi.mocked(archiveOffice).mockRejectedValueOnce(new Error('Move its 1 person and 1 space first.'))
  await renderAt('/admin/offices?office=o1')
  await act(async () => button('Archive')!.click())
  await act(async () => button('Archive office')!.click())
  expect(archiveOffice).toHaveBeenCalledWith('o1')
  const alert = document.querySelector('[role="alert"]')
  expect(alert?.textContent).toContain('Move its 1 person and 1 space first.')
})

it('an empty program shows "No offices yet" with New office', async () => {
  vi.mocked(listOffices).mockResolvedValueOnce([])
  await renderAt('/admin/offices')
  const empty = document.querySelector('[data-offices-empty]')
  expect(empty?.textContent).toContain('No offices yet')
  const add = [...(empty?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === 'New office')
  expect(add).toBeDefined()
  await act(async () => add!.click())
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('New office')
  expect(document.querySelector('[aria-label="Offices"]')).toBeNull()
})
