// @vitest-environment happy-dom
import * as React from 'react'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { OverviewTab } from './OverviewTab'
import type { GeneralProjectState } from './useGeneralProject'
import { requestForProject } from '../../lib/api/projectRequests'

vi.mock('../../lib/api/projectRequests', () => ({ requestForProject: vi.fn() }))
vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const state = {
  project: { id: 'project', class_board_id: null, description: 'Agreed brief' },
  fields: [], values: [], can: () => false, nameOf: () => '',
} as unknown as GeneralProjectState
const request = {
  id: 'source', space_id: 'space', author_id: 'author', title: 'Customer portal',
  brief: 'Agreed brief', desired_outcome: 'Launch', target_date: null,
  status: 'converted' as const, converted_project_id: 'project', created_at: '', updated_at: '',
}

afterEach(() => { vi.clearAllMocks(); document.body.innerHTML = '' })

it('links an authorized reader to the selected source request', async () => {
  vi.mocked(requestForProject).mockResolvedValue(request)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  await act(async () => root.render(createElement(MemoryRouter, null, createElement(OverviewTab, { state }))))
  expect(requestForProject).toHaveBeenCalledWith('project')
  expect(document.querySelector<HTMLAnchorElement>('a[href="/spaces/space/projects?request=source"]')?.textContent).toBe('Source request')
  await act(async () => root.unmount())
})

it('shows no source link when the request is hidden by RLS', async () => {
  vi.mocked(requestForProject).mockResolvedValue(null)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  await act(async () => root.render(createElement(MemoryRouter, null, createElement(OverviewTab, { state }))))
  expect(document.body.textContent).not.toContain('Source request')
  await act(async () => root.unmount())
})
