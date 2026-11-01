// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { FilesTab } from './FilesTab'
import { getRepo } from '../../lib/api/general'
import type { GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../../hooks/useLive', () => ({ useLive: vi.fn() }))
vi.mock('./RequestAccessButton', () => ({ RequestAccessButton: () => 'Request access' }))
vi.mock('./SharedTab', () => ({ SharedTab: () => null }))
vi.mock('../../lib/api/general', async importOriginal => ({
  ...await importOriginal<object>(),
  getRepo: vi.fn(),
  listTree: async () => [],
  listCommits: async () => [],
  listRepoChanges: async () => [],
  myDraft: async () => ({ id: 'draft' }),
  listDraftFiles: async () => [],
  draftConflicts: async () => [],
}))

const repo = { id: 'repo', name: 'Files', file_count: 0, commit_count: 0, last_author: null, last_commit_at: null }

/** Somebody reading a Workspace work project from its space, with no role on it. */
const viewer = {
  project: { id: 'p', class_board_id: null, has_code: false },
  myRole: null, readOnly: true, viewerId: 'viewer',
  can: () => false, nameOf: (id: string) => id,
  commitRights: { commit: false, grant: false, board: false, committers: [] },
} as unknown as GeneralProjectState

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = null
  root = null
  vi.mocked(getRepo).mockReset()
})

async function show(state: GeneralProjectState) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<MemoryRouter initialEntries={['/?tab=files']}><FilesTab state={state} /></MemoryRouter>))
}

const buttons = () => [...host!.querySelectorAll('button')].map((b) => b.textContent?.trim())

it('tells a viewer with no role that the files are for members', async () => {
  vi.mocked(getRepo).mockResolvedValue(null)
  await show(viewer)
  expect(host!.textContent).toContain('Join the project to see its files.')
  expect(host!.textContent).not.toContain('No files yet')
  expect(host!.textContent).not.toContain('Request access')
  expect(buttons()).not.toContain("Start the project's files")
})

it('offers a viewer with no role no New button or access request', async () => {
  vi.mocked(getRepo).mockResolvedValue(repo as never)
  await show(viewer)
  expect(host!.textContent).toContain('Files')
  expect(buttons()).not.toContain('New')
  expect(host!.textContent).not.toContain('Request access')
})

it('keeps the empty state and New for a member', async () => {
  const member = { ...viewer, myRole: 'member', readOnly: false } as unknown as GeneralProjectState
  vi.mocked(getRepo).mockResolvedValue(null)
  await show(member)
  expect(host!.textContent).toContain('No files yet')
  await act(async () => root!.unmount())
  host!.remove()
  vi.mocked(getRepo).mockResolvedValue(repo as never)
  await show(member)
  expect(buttons()).toContain('New')
})
