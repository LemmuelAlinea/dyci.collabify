// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import OrgSettings from './OrgSettings'
import {
  getOrganizationSettings,
  setOrganizationSettings,
  trashPurgePreview,
} from '../../../lib/api/orgSettings'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const toast = vi.hoisted(() => vi.fn())
vi.mock('../../../components/ui/Toast', () => ({ useToast: () => ({ show: toast }) }))
vi.mock('../../../lib/api/orgSettings', () => ({
  getOrganizationSettings: vi.fn(async () => ({
    quiet_days: 14,
    trash_retention_days: 30,
    new_project_visibility: 'private',
    school_email_domain: 'dyci.edu.ph',
  })),
  setOrganizationSettings: vi.fn(async (s: object) => ({
    quiet_days: 14,
    trash_retention_days: 30,
    new_project_visibility: 'private',
    school_email_domain: 'dyci.edu.ph',
    ...s,
  })),
  trashPurgePreview: vi.fn(async () => 5),
}))

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null

afterEach(async () => {
  vi.useRealTimers()
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
  await act(async () => root!.render(<OrgSettings />))
}

const input = (label: string) =>
  [...document.querySelectorAll('label')]
    .find((l) => l.textContent?.startsWith(label))
    ?.parentElement?.parentElement?.querySelector('input') as HTMLInputElement
const save = () =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Save settings')) as HTMLButtonElement
const type = (el: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })

it('loads the saved values and keeps Save off until something changes', async () => {
  await render()
  expect(input('Quiet after').value).toBe('14')
  expect(input('Trash keeps').value).toBe('30')
  expect(input('School email domain').value).toBe('dyci.edu.ph')
  expect(document.body.textContent).toContain('@')
  expect(save().disabled).toBe(true)
})

it('refuses out-of-range input before saving', async () => {
  await render()
  await type(input('Quiet after'), '2')
  expect(document.body.textContent).toContain('Enter a whole number of days from 3 to 90.')
  expect(save().disabled).toBe(true)
  await type(input('Trash keeps'), '6')
  expect(document.body.textContent).toContain('Enter a whole number of days from 7 to 365.')
  await type(input('School email domain'), 'bad domain')
  expect(document.body.textContent).toContain('Enter a domain like dyci.edu.ph, with no @ and no spaces.')
  expect(setOrganizationSettings).not.toHaveBeenCalled()
})

it('shows how many trashed items could go when retention is lowered', async () => {
  await render()
  vi.useFakeTimers()
  await type(input('Trash keeps'), '10')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
  expect(trashPurgePreview).toHaveBeenCalledWith(10)
  expect(document.body.textContent).toContain(
    'Up to 5 trashed items could be deleted at the next nightly clean-up.',
  )
})

it('says so when the trash count could not load', async () => {
  vi.mocked(trashPurgePreview).mockRejectedValueOnce({ message: 'down' })
  await render()
  vi.useFakeTimers()
  await type(input('Trash keeps'), '10')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
  expect(document.body.textContent).toContain(
    'Could not count the trash that would be deleted. Saving still works.',
  )
  expect(document.body.textContent).not.toContain('could be deleted at the next')
})

it('clears the count while a new one loads', async () => {
  await render()
  vi.useFakeTimers()
  await type(input('Trash keeps'), '10')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
  expect(document.body.textContent).toContain('Up to 5 trashed items')
  await type(input('Trash keeps'), '12')
  expect(document.body.textContent).not.toContain('Up to 5 trashed items')
})

it('saves only the changed values and toasts', async () => {
  await render()
  await type(input('Quiet after'), '30')
  await act(async () => save().click())
  expect(setOrganizationSettings).toHaveBeenCalledWith({ quiet_days: 30 })
  expect(toast).toHaveBeenCalledWith('Settings saved')
  expect(save().disabled).toBe(true)
})

it('shows a database refusal as it is', async () => {
  vi.mocked(setOrganizationSettings).mockRejectedValueOnce({
    message: 'Only an admin can change organization settings.',
  })
  await render()
  await type(input('Quiet after'), '30')
  await act(async () => save().click())
  expect(document.body.textContent).toContain('Only an admin can change organization settings.')
})

it('offers a retry when the settings fail to load', async () => {
  vi.mocked(getOrganizationSettings).mockRejectedValueOnce({ message: 'Network down.' })
  await render()
  expect(document.body.textContent).toContain('Network down.')
  expect(document.body.textContent).toContain('Try again')
})
