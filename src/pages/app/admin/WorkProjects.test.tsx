// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import WorkProjects from './WorkProjects'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

vi.mock('../../../hooks/useLive', () => ({ useLive: () => {} }))
vi.mock('../../../lib/api/general', () => ({
  listAdminWorkProjects: vi.fn(async () => [
    { id: 'p1', name: 'Helpdesk revamp', space_name: 'Helpdesk', pm_name: null, has_pm: false, archived_at: null },
    { id: 'p2', name: 'Records cleanup', space_name: 'Records', pm_name: 'Ana Cruz', has_pm: true, archived_at: null },
  ]),
}))
vi.mock('../../../components/general/NoPmNotice', () => ({
  AssignPmDialog: ({ open, projectId, projectName }: { open: boolean; projectId: string; projectName: string }) =>
    open ? <div data-assign-dialog={projectId}>{projectName}</div> : null,
}))

let where = ''
function Probe() {
  const l = useLocation()
  where = l.pathname + l.search
  return null
}

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
        <WorkProjects />
        <Probe />
      </MemoryRouter>,
    ),
  )
}

const dialog = () => document.querySelector('[data-assign-dialog]')

it('opens Assign for the project named in ?assign= and drops the param', async () => {
  await renderAt('/admin/projects?assign=p1')
  expect(dialog()?.getAttribute('data-assign-dialog')).toBe('p1')
  expect(dialog()?.textContent).toBe('Helpdesk revamp')
  expect(where).toBe('/admin/projects')
})

it('shows the list normally when ?assign= names no project', async () => {
  await renderAt('/admin/projects?assign=gone')
  expect(dialog()).toBeNull()
  expect(document.body.textContent).toContain('Helpdesk revamp')
  expect(document.body.textContent).toContain('Records cleanup')
  expect(where).toBe('/admin/projects')
})

it('opens nothing without ?assign=', async () => {
  await renderAt('/admin/projects')
  expect(dialog()).toBeNull()
  expect(document.body.textContent).toContain('2 projects')
})
