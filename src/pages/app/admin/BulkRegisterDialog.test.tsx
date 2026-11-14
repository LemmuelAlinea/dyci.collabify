// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { BulkRegisterDialog } from './BulkRegisterDialog'
import { resetOrgSettingsCache } from '../../../hooks/useOrgSettings'
import { ServerMessageError } from '../../../lib/api/functions'
import { getOrganizationSettings } from '../../../lib/api/orgSettings'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

vi.mock('../../../lib/api/accounts', () => ({ listAccounts: vi.fn(async () => []), registerBulkUsers: vi.fn() }))
vi.mock('../../../lib/api/orgSettings', () => ({ getOrganizationSettings: vi.fn() }))

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = null
  root = null
  resetOrgSettingsCache()
  vi.clearAllMocks()
})

it('names the configured domain in the description and checks the CSV against it', async () => {
  vi.mocked(getOrganizationSettings).mockResolvedValue({
    quiet_days: 14,
    trash_retention_days: 30,
    new_project_visibility: 'private',
    school_email_domain: 'school.test',
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<BulkRegisterDialog open onClose={() => {}} onImported={async () => {}} />))
  expect(document.body.textContent).toContain('Only @school.test addresses are accepted.')

  const file = new File(
    ['first_name,last_name,email,role\nAna,Cruz,ana@dyci.edu.ph,student\nBo,Lee,bo@school.test,member'],
    'users.csv',
    { type: 'text/csv' },
  )
  const input = document.body.querySelector('input[type="file"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [file] })
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(async () => {})
  expect(document.body.textContent).toContain('Use a valid @school.test email.')
})

async function mount() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<BulkRegisterDialog open onClose={() => {}} onImported={async () => {}} />))
}
const picker = () => document.body.querySelector('input[type="file"]') as HTMLInputElement
const row = { quiet_days: 14, trash_retention_days: 30, new_project_visibility: 'private' as const, school_email_domain: 'school.test' }

it('keeps the file picker off until the domain has arrived', async () => {
  let release: (value: typeof row) => void = () => {}
  vi.mocked(getOrganizationSettings).mockReturnValue(new Promise((resolve) => { release = resolve }))
  await mount()
  expect(picker().disabled).toBe(true)
  expect(document.body.textContent).toContain('Loading the school email domain…')
  expect(document.body.textContent).not.toContain('@dyci.edu.ph')
  await act(async () => release(row))
  expect(picker().disabled).toBe(false)
  expect(document.body.textContent).toContain('Only @school.test addresses are accepted.')
})

it('offers Try again when the domain cannot be read, and recovers', async () => {
  vi.mocked(getOrganizationSettings).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(row)
  await mount()
  expect(picker().disabled).toBe(true)
  expect(document.body.textContent).toContain('Could not read the school email domain. Try again.')
  const again = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes('Try again')) as HTMLButtonElement
  await act(async () => again.click())
  await act(async () => {})
  expect(picker().disabled).toBe(false)
  expect(document.body.textContent).toContain('Only @school.test addresses are accepted.')
})

async function failImport(error: Error) {
  vi.mocked(getOrganizationSettings).mockResolvedValue(row)
  const { registerBulkUsers } = await import('../../../lib/api/accounts')
  vi.mocked(registerBulkUsers).mockRejectedValue(error)
  await mount()
  const file = new File(['first_name,last_name,email,role\nBo,Lee,bo@school.test,member'], 'users.csv', { type: 'text/csv' })
  Object.defineProperty(picker(), 'files', { value: [file] })
  await act(async () => { picker().dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => {})
  const type = (el: HTMLInputElement, v: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  await act(async () => type(document.body.querySelector('input[type="password"]') as HTMLInputElement, 'twelve-chars-ok'))
  const go = [...document.body.querySelectorAll('button')].find((b) => /^(Review|Continue|Import)/.test(b.textContent ?? '')) as HTMLButtonElement
  await act(async () => go.click())
  const run = [...document.body.querySelectorAll('button')].find((b) => /^Import/.test(b.textContent ?? '')) as HTMLButtonElement
  await act(async () => run.click())
  await act(async () => {})
}

it('shows the server message when a group cannot be sent', async () => {
  await failImport(new ServerMessageError('Could not read the school email domain. Try again in a moment.'))
  expect(document.body.textContent).toContain('Could not read the school email domain. Try again in a moment.')
})

it('hides a transport error behind the retry line', async () => {
  await failImport(new Error('Edge Function returned a non-2xx status code'))
  expect(document.body.textContent).not.toContain('non-2xx')
  expect(document.body.textContent).toContain('Could not send this group. Upload the CSV again to retry.')
})
