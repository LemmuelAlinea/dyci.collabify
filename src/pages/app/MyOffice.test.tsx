// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import MyOffice from './MyOffice'
import {
  myHeadedOffice,
  myOfficeAttention,
  myOfficeOverview,
  myOfficePeople,
  myOfficeSpaces,
} from '../../lib/api/officeHeads'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

vi.mock('../../lib/api/officeHeads', () => ({
  myHeadedOffice: vi.fn(async () => ({ office_id: 'o1', office_name: 'IT services' })),
  myOfficeOverview: vi.fn(async () => ({ spaces: 2, running_projects: 5, people: 7, needs_attention: 2 })),
  myOfficeAttention: vi.fn(async () => [
    {
      project_id: 'p1',
      project_name: 'Helpdesk revamp',
      space_name: 'Helpdesk',
      no_pm: true,
      quiet_since: null,
      i_am_on: true,
    },
    {
      project_id: 'p2',
      project_name: 'Network audit',
      space_name: 'Infrastructure',
      no_pm: false,
      quiet_since: '2026-10-28T03:00:00Z',
      i_am_on: false,
    },
  ]),
  myOfficeSpaces: vi.fn(async () => [
    { space_id: 's1', space_name: 'Helpdesk', running_projects: 3 },
    { space_id: 's2', space_name: 'Infrastructure', running_projects: 2 },
  ]),
  myOfficePeople: vi.fn(async () => [
    { id: 'u1', name: 'Ana Cruz' },
    { id: 'u2', name: 'Ben Reyes' },
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
      <MemoryRouter initialEntries={['/office']}>
        <Routes>
          <Route path="/office" element={<MyOffice />} />
          <Route path="/home" element={<p data-home>Home</p>} />
        </Routes>
      </MemoryRouter>,
    ),
  )
}

const band = (name: string) => document.querySelector(`[data-home-band="${name}"]`)

it('renders the four bands', async () => {
  await render()
  expect(document.querySelector('h1')?.textContent).toContain('IT services')
  const figures = band('figures')!
  expect([...figures.querySelectorAll('[data-figure]')].map((f) => f.textContent)).toEqual([
    'Spaces2',
    'Running projects5',
    'People7',
    'Needs attention2',
  ])
  const attention = [...band('attention')!.querySelectorAll('li')]
  expect(attention).toHaveLength(2)
  expect(attention[0].textContent).toContain('Helpdesk revamp')
  expect(attention[0].textContent).toContain('No project manager')
  expect(attention[1].textContent).toContain('Quiet since')
  const spaces = [...band('spaces')!.querySelectorAll('li')].map((l) => l.textContent)
  expect(spaces).toEqual(['Helpdesk3', 'Infrastructure2'])
  const people = [...band('people')!.querySelectorAll('li')].map((l) => l.textContent)
  expect(people).toEqual(['Ana Cruz', 'Ben Reyes'])
})

it('links only projects the head is on', async () => {
  await render()
  const [on, off] = [...band('attention')!.querySelectorAll('li')]
  expect(on.querySelector('a')?.getAttribute('href')).toBe('/projects/p1')
  expect(off.querySelector('a')).toBeNull()
  expect(off.textContent).toContain('Network audit')
})

it('a failed band shows a retry while the others render', async () => {
  vi.mocked(myOfficeAttention).mockRejectedValueOnce(new Error('offline'))
  await render()
  const alert = band('attention')!.querySelector('[role="alert"]')
  expect(alert?.textContent).toContain('Try again')
  expect(band('attention')!.querySelectorAll('li')).toHaveLength(0)
  expect(band('figures')!.querySelectorAll('[data-figure]')).toHaveLength(4)
  expect(band('spaces')!.querySelectorAll('li')).toHaveLength(2)
  expect(band('people')!.querySelectorAll('li')).toHaveLength(2)

  const retry = [...alert!.querySelectorAll('button')].find((b) => b.textContent === 'Try again')!
  await act(async () => retry.click())
  expect(myOfficeAttention).toHaveBeenCalledTimes(2)
  expect(band('attention')!.querySelectorAll('li')).toHaveLength(2)
})

it('says so when nothing in the office needs attention', async () => {
  vi.mocked(myOfficeAttention).mockResolvedValueOnce([])
  vi.mocked(myOfficeSpaces).mockResolvedValueOnce([])
  await render()
  expect(band('attention')!.textContent).toContain(
    'Every running project in your office has a project manager and recent activity.',
  )
  expect(band('spaces')!.textContent).toContain('No work spaces are filed under your office yet.')
})

it('a non-head is sent Home', async () => {
  vi.mocked(myHeadedOffice).mockResolvedValueOnce(null)
  await render()
  expect(document.querySelector('[data-home]')).not.toBeNull()
  expect(band('figures')).toBeNull()
  expect(myOfficeOverview).not.toHaveBeenCalled()
  expect(myOfficePeople).not.toHaveBeenCalled()
})

it('shows a spinner while it asks, and a retry when the office does not load', async () => {
  let fail: (e: Error) => void = () => {}
  vi.mocked(myHeadedOffice).mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
  await render()
  expect(document.querySelector('[role="status"]')).not.toBeNull()
  expect(band('figures')).toBeNull()
  await act(async () => fail(new Error('offline')))
  const retry = [...document.querySelectorAll('[role="alert"] button')].find((b) => b.textContent === 'Try again')!
  await act(async () => (retry as HTMLButtonElement).click())
  expect(myHeadedOffice).toHaveBeenCalledTimes(2)
  expect(band('figures')).not.toBeNull()
})
