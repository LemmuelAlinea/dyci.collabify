// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import Trash from './Trash'
import { resetOrgSettingsCache } from '../../hooks/useOrgSettings'
import { getOrganizationSettings } from '../../lib/api/orgSettings'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../../lib/api/trash', () => ({
  deleteTrashItem: vi.fn(),
  emptyMyTrash: vi.fn(),
  isArchivedTrashKind: () => false,
  listMyTrash: vi.fn(async () => []),
  restoreTrashItem: vi.fn(),
}))
vi.mock('../../lib/api/orgSettings', () => ({ getOrganizationSettings: vi.fn() }))

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

async function render() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<MemoryRouter><Trash /></MemoryRouter>))
}

it('says the configured retention in every line of copy', async () => {
  vi.mocked(getOrganizationSettings).mockResolvedValue({
    quiet_days: 14,
    trash_retention_days: 45,
    new_project_visibility: 'private',
    school_email_domain: 'dyci.edu.ph',
  })
  await render()
  const text = document.body.textContent ?? ''
  expect(text).toContain('waits here for 45 days, then goes for good')
  expect(text).toContain('it waits here for 45 days before it is deleted')
  expect(text).not.toContain('30 days')
})

it('keeps saying 30 days when the settings cannot be read', async () => {
  vi.mocked(getOrganizationSettings).mockRejectedValue(new Error('offline'))
  await render()
  expect(document.body.textContent).toContain('waits here for 30 days, then goes for good')
})
