// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { BulkRegisterDialog } from './BulkRegisterDialog'
import { resetOrgSettingsCache } from '../../../hooks/useOrgSettings'
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
