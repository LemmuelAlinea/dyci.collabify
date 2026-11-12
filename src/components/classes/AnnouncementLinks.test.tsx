// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { LinkList } from './AnnouncementLinks'
import { findMyTaskCopy } from '../../lib/api/announcements'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../lib/api/announcements', () => ({
  findMyTaskCopy: vi.fn(),
  listLinkOptions: vi.fn(),
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

function Where() {
  const l = useLocation()
  return <output>{l.pathname + l.search}</output>
}

const link = { kind: 'task' as const, id: 'origin-1', project_id: 'p1', label: 'Write the method' }

async function open(teacher: boolean) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <MemoryRouter initialEntries={['/feed']}>
        <Routes>
          <Route path="/feed" element={<LinkList links={[link]} teacher={teacher} />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    ),
  )
  const button = host.querySelector('[aria-label="Open task Write the method"]') as HTMLButtonElement
  await act(async () => button.click())
  await act(async () => {})
  return host.querySelector('output')?.textContent
}

it('sends a teacher to the Tasks tab, never a dialog named by the origin id', async () => {
  expect(await open(true)).toBe('/class-projects/p1?tab=tasks')
  expect(findMyTaskCopy).not.toHaveBeenCalled()
})

it('still opens a student their own group copy', async () => {
  vi.mocked(findMyTaskCopy).mockResolvedValue('copy-9' as never)
  expect(await open(false)).toBe('/class-projects/p1?task=copy-9')
  expect(findMyTaskCopy).toHaveBeenCalledWith('origin-1')
})
