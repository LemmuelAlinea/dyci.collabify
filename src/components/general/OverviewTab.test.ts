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

const detailed = (over: Record<string, unknown> = {}) => ({
  project: {
    id: 'project', class_board_id: null, name: 'Alpha', description: 'Agreed brief', status: 'planning',
    starts_on: null, ends_on: null, stages: ['Plan', 'Build', 'Ship'], qa_stage: null,
  },
  fields: [{ id: 'f1', name: 'Budget', type: 'text', options: [], sort: 0 }],
  values: [{ field_id: 'f1', value: 'PHP 5,000' }],
  members: [], nameOf: () => '', readOnly: false, can: () => true,
  ...over,
}) as unknown as GeneralProjectState

async function openInfo(s: GeneralProjectState) {
  vi.mocked(requestForProject).mockResolvedValue(null)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  await act(async () => root.render(createElement(MemoryRouter, null, createElement(OverviewTab, { state: s }))))
  const open = [...host.querySelectorAll('button')].find((b) => b.textContent === 'View all')
  expect(open).toBeDefined()
  await act(async () => open!.click())
  return { host, root, dialog: document.querySelector<HTMLElement>('[role="dialog"]')! }
}

it('shows Project info read-only, with details, stages and fields', async () => {
  const { root, dialog } = await openInfo(detailed())
  expect(dialog.textContent).toContain('Agreed brief')
  expect(dialog.textContent).toContain('Plan → Build → Ship')
  expect(dialog.textContent).toContain('Budget')
  expect(dialog.textContent).toContain('PHP 5,000')
  expect(dialog.querySelector('input, textarea, select')).toBeNull()
  expect([...dialog.querySelectorAll('button')].map((b) => b.textContent)).not.toContain('Edit')
  await act(async () => root.unmount())
})

it('links an editor from Project info to Settings', async () => {
  const { root, dialog } = await openInfo(detailed())
  const links = [...dialog.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])
  expect(links).toContainEqual(['Edit in Settings', '/?tab=settings&section=general'])
  expect(links).toContainEqual(['Edit stages in Settings', '/?tab=settings&section=tasks'])
  await act(async () => root.unmount())
})

it('offers no Settings link to somebody who cannot edit or while read-only', async () => {
  for (const over of [{ can: () => false }, { readOnly: true }]) {
    const { root, dialog } = await openInfo(detailed(over))
    expect(dialog.textContent).not.toContain('in Settings')
    await act(async () => root.unmount())
    document.body.innerHTML = ''
  }
})
