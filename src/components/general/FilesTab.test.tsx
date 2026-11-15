// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { FilesTab } from './FilesTab'
import { commitFiles, getRepo, listTree } from '../../lib/api/general'
import { listPulls } from '../../lib/api/filePulls'
import type { GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../../hooks/useLive', () => ({ useLive: vi.fn() }))
vi.mock('./RequestAccessButton', () => ({ RequestAccessButton: () => 'Request access' }))
vi.mock('./SharedTab', () => ({ SharedTab: () => null }))
vi.mock('../../lib/api/filePulls', () => ({
  listPulls: vi.fn(async () => []),
  pullFile: vi.fn(),
  endPull: vi.fn(),
  pushState: vi.fn(),
}))
vi.mock('../../lib/api/general', async importOriginal => ({
  ...await importOriginal<object>(),
  getRepo: vi.fn(),
  listTree: vi.fn(async () => []),
  listCommits: async () => [],
  listRepoChanges: async () => [],
  myDraft: async () => ({ id: 'draft' }),
  listDraftFiles: async () => [],
  draftConflicts: async () => [],
  commitFiles: vi.fn(async () => ({ seq: 2 })),
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

it('shows who else is editing a Main file, never the viewer', async () => {
  const member = { ...viewer, myRole: 'member', readOnly: false } as unknown as GeneralProjectState
  vi.mocked(getRepo).mockResolvedValue({ ...repo, file_count: 2 } as never)
  const file = (path: string) => ({ id: path, repo_id: 'repo', project_id: 'p', commit_id: 'c', seq: 1, path, kind: 'binary', content: '', storage_path: 's', size: 1, created_at: '2026-11-14T00:00:00Z' })
  vi.mocked(listTree).mockResolvedValue([file('Chap1.docx'), file('Chap2.docx')] as never)
  const now = new Date().toISOString()
  vi.mocked(listPulls).mockResolvedValue([
    { repo_id: 'repo', project_id: 'p', path: 'Chap1.docx', user_id: 'Ana', base_seq: 1, pulled_at: now },
    { repo_id: 'repo', project_id: 'p', path: 'Chap2.docx', user_id: 'viewer', base_seq: 1, pulled_at: now },
  ])
  await show(member)
  expect(host!.textContent).toContain('Ana is editing')
  expect(host!.textContent).not.toContain('viewer is editing')
  vi.mocked(listTree).mockResolvedValue([])
  vi.mocked(listPulls).mockResolvedValue([])
})

it('offers Ask when Main has a Word file, and not for PDFs alone', async () => {
  const member = { ...viewer, myRole: 'member', readOnly: false } as unknown as GeneralProjectState
  const file = (path: string) => ({ id: path, repo_id: 'repo', project_id: 'p', commit_id: 'c', seq: 1, path, kind: 'binary', content: '', storage_path: 's', size: 1, created_at: '2026-11-14T00:00:00Z' })
  vi.mocked(getRepo).mockResolvedValue({ ...repo, file_count: 1 } as never)
  vi.mocked(listTree).mockResolvedValue([file('Chap1.docx')] as never)
  await show(member)
  expect(host!.querySelector('section[aria-label="Ask about these files"]')).not.toBeNull()
  await act(async () => root!.unmount())
  host!.remove()
  vi.mocked(getRepo).mockResolvedValue({ ...repo, file_count: 1 } as never)
  vi.mocked(listTree).mockResolvedValue([file('Scan.pdf')] as never)
  await show(member)
  expect(host!.querySelector('section[aria-label="Ask about these files"]')).toBeNull()
  vi.mocked(listTree).mockResolvedValue([])
})

async function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const menuItems = () => [...document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] button')].map((b) => b.textContent?.trim())

it('offers Download and Delete file on a Main file, and deletes only after the name is typed', async () => {
  const member = { ...viewer, myRole: 'member', readOnly: false, can: (p: string) => p === 'commit_main' } as unknown as GeneralProjectState
  const doc = { id: 'n', repo_id: 'repo', project_id: 'p', commit_id: 'c', seq: 1, path: 'Notes.txt', kind: 'text', content: 'hi', storage_path: null, size: 2, created_at: '2026-11-14T00:00:00Z' }
  vi.mocked(getRepo).mockResolvedValue({ ...repo, file_count: 1, commit_count: 1 } as never)
  vi.mocked(listTree).mockResolvedValue([doc] as never)
  await show(member)
  const trigger = host!.querySelector<HTMLButtonElement>('button[aria-label="More for Notes.txt"]')!
  await act(async () => trigger.click())
  expect(menuItems()).toEqual(expect.arrayContaining(['Download', 'Delete file']))
  const del = [...document.querySelectorAll<HTMLElement>('[role="menu"] *')].find((b) => b.textContent?.trim() === 'Delete file' && b.tagName === 'BUTTON')!
  await act(async () => del.click())
  expect(document.body.textContent).toContain('Delete Notes.txt from Main?')
  const confirmButton = () => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Delete file' && !b.closest('[role="menu"]'))
  expect(confirmButton()).toBeUndefined()
  await type(document.getElementById('delete-main-file-name') as HTMLInputElement, 'Notes.txt')
  await act(async () => confirmButton()!.click())
  expect(commitFiles).toHaveBeenCalledWith({
    repoId: 'repo',
    message: 'Deleted Notes.txt',
    baseSeq: 1,
    files: [{ path: 'Notes.txt', action: 'removed', kind: 'text', content: '', storage_path: null }],
  })
  vi.mocked(listTree).mockResolvedValue([])
})

it('offers only Download to someone who cannot commit to Main', async () => {
  const member = { ...viewer, myRole: 'member', readOnly: false } as unknown as GeneralProjectState
  const doc = { id: 'n', repo_id: 'repo', project_id: 'p', commit_id: 'c', seq: 1, path: 'Notes.txt', kind: 'text', content: 'hi', storage_path: null, size: 2, created_at: '2026-11-14T00:00:00Z' }
  vi.mocked(getRepo).mockResolvedValue({ ...repo, file_count: 1, commit_count: 1 } as never)
  vi.mocked(listTree).mockResolvedValue([doc] as never)
  await show(member)
  await act(async () => host!.querySelector<HTMLButtonElement>('button[aria-label="More for Notes.txt"]')!.click())
  expect(menuItems()).toContain('Download')
  expect(menuItems()).not.toContain('Delete file')
  vi.mocked(listTree).mockResolvedValue([])
})
