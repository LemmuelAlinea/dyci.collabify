// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { FilesTab } from './FilesTab'
import { commitFiles, getRepo, listCommitFiles, listCommits, listDraftFiles, listTree } from '../../lib/api/general'
import { commitOrigins, fileVersions, restoreToDraft, revertCommit } from '../../lib/api/fileHistory'
import { listPulls } from '../../lib/api/filePulls'
import type { GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
const toast = vi.hoisted(() => vi.fn())
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: toast }) }))
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
  listCommits: vi.fn(async () => []),
  listCommitFiles: vi.fn(async () => []),
  contentAt: vi.fn(async () => ''),
  listRepoChanges: async () => [],
  myDraft: async () => ({ id: 'draft' }),
  listDraftFiles: vi.fn(async () => []),
  draftConflicts: async () => [],
  commitFiles: vi.fn(async () => ({ seq: 2 })),
}))
vi.mock('../../lib/api/fileHistory', () => ({
  fileVersions: vi.fn(async () => []),
  commitOrigins: vi.fn(async () => ({})),
  revertCommit: vi.fn(async () => ({ seq: 3 })),
  restoreFile: vi.fn(),
  restoreToDraft: vi.fn(async () => {}),
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
  expect(menuItems()).toEqual(expect.arrayContaining(['Properties', 'Download', 'Delete file']))
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

it('offers Properties and Download to someone who cannot commit to Main', async () => {
  const member = { ...viewer, myRole: 'member', readOnly: false } as unknown as GeneralProjectState
  const doc = { id: 'n', repo_id: 'repo', project_id: 'p', commit_id: 'c', seq: 1, path: 'Notes.txt', kind: 'text', content: 'hi', storage_path: null, size: 2, created_at: '2026-11-14T00:00:00Z' }
  vi.mocked(getRepo).mockResolvedValue({ ...repo, file_count: 1, commit_count: 1 } as never)
  vi.mocked(listTree).mockResolvedValue([doc] as never)
  await show(member)
  await act(async () => host!.querySelector<HTMLButtonElement>('button[aria-label="More for Notes.txt"]')!.click())
  expect(menuItems()).toContain('Properties')
  expect(menuItems()).toContain('Download')
  expect(menuItems()).not.toContain('Delete file')
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find((button) => button.textContent?.trim() === 'Properties')!.click())
  expect(document.body.querySelector('dl')?.textContent).toContain('Notes.txt')
  expect(document.body.querySelector('dl')?.textContent).toContain('2 B')
  vi.mocked(listTree).mockResolvedValue([])
})

it('shows folder properties with the total size of its files', async () => {
  const member = { ...viewer, myRole: 'member', readOnly: false } as unknown as GeneralProjectState
  const file = (path: string, content: string) => ({ id: path, repo_id: 'repo', project_id: 'p', commit_id: 'c', seq: 1, path, kind: 'text', content, storage_path: null, size: content.length, created_at: '2026-11-14T00:00:00Z' })
  vi.mocked(getRepo).mockResolvedValue({ ...repo, file_count: 2, commit_count: 1 } as never)
  vi.mocked(listTree).mockResolvedValue([file('docs/Notes.txt', 'hello'), file('docs/.keep', '')] as never)
  await show(member)
  await act(async () => host!.querySelector<HTMLButtonElement>('button[aria-label="Actions for docs"]')!.click())
  expect(menuItems()).toContain('Properties')
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find((button) => button.textContent?.trim() === 'Properties')!.click())
  expect(document.body.querySelector('dl')?.textContent).toContain('docs')
  expect(document.body.querySelector('dl')?.textContent).toContain('5 B')
  vi.mocked(listTree).mockResolvedValue([])
})

/* ----------------------------------------------------------------- history */

const commit = (seq: number, message: string) => ({ id: `c${seq}`, repo_id: 'repo', project_id: 'p', seq, message, author_id: 'Ana', change_id: null, created_at: '2026-11-14T00:00:00Z' })
const blob = (seq: number, path: string, action = 'changed', content = `v${seq}`) => ({ id: `${path}@${seq}`, commit_id: `c${seq}`, repo_id: 'repo', project_id: 'p', seq, path, action, kind: 'text', content, storage_path: null, created_at: '2026-11-14T00:00:00Z' })

async function showHistory(state: GeneralProjectState) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<MemoryRouter initialEntries={['/?tab=files&view=history']}><FilesTab state={state} /></MemoryRouter>))
}

async function expand(message: string) {
  const row = [...host!.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find((b) => b.textContent?.includes(message))!
  await act(async () => row.click())
}

const click = async (label: string, within: ParentNode = document) =>
  act(async () => [...within.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label)!.click())

function historyFixture() {
  vi.mocked(getRepo).mockResolvedValue({ ...repo, file_count: 1, commit_count: 2 } as never)
  vi.mocked(listTree).mockResolvedValue([{ ...blob(2, 'a.md'), size: 2 }] as never)
  vi.mocked(listCommits).mockResolvedValue([commit(2, 'Second pass'), commit(1, 'First draft')] as never)
  vi.mocked(listCommitFiles).mockResolvedValue([blob(2, 'a.md')] as never)
  vi.mocked(fileVersions).mockResolvedValue([
    { ...blob(2, 'a.md'), commit: commit(2, 'Second pass') },
    { ...blob(1, 'a.md', 'added'), commit: commit(1, 'First draft') },
  ] as never)
}

afterEach(() => {
  vi.mocked(listTree).mockResolvedValue([])
  vi.mocked(listCommits).mockResolvedValue([])
  vi.mocked(listCommitFiles).mockResolvedValue([])
  vi.mocked(listDraftFiles).mockResolvedValue([])
  vi.mocked(commitOrigins).mockResolvedValue({})
  vi.mocked(fileVersions).mockResolvedValue([])
  vi.mocked(restoreToDraft).mockClear()
  vi.mocked(revertCommit).mockClear()
})

const committer = { ...viewer, myRole: 'member', readOnly: false, can: (p: string) => p === 'commit_main' } as unknown as GeneralProjectState
const drafter = { ...viewer, myRole: 'member', readOnly: false } as unknown as GeneralProjectState

it('offers a committer Revert commit on an expanded commit and Undo this change per file', async () => {
  historyFixture()
  await showHistory(committer)
  await expand('Second pass')
  expect(buttons()).toContain('Revert commit')
  expect(buttons()).toContain('Undo this change')
  expect(host!.querySelector('button[aria-label="Undo this change: a.md"]')).not.toBeNull()
  expect(buttons()).not.toContain('Revert in my draft')
})

it('reverts into Main with the repo base and the edited message', async () => {
  historyFixture()
  await showHistory(committer)
  await expand('Second pass')
  await click('Revert commit', host!)
  expect(document.body.textContent).toContain('Revert #2?')
  expect((document.getElementById('put-back-message') as HTMLInputElement).value).toBe('Revert #2: Second pass')
  await click('Put back in Main')
  expect(revertCommit).toHaveBeenCalledWith('c2', 2, undefined, 'Revert #2: Second pass')
  expect(toast).toHaveBeenLastCalledWith('Reverted #2')
})

it('undoes one file in Main and says which file', async () => {
  historyFixture()
  await showHistory(committer)
  await expand('Second pass')
  await click('Undo this change', host!)
  expect((document.getElementById('put-back-message') as HTMLInputElement).value).toBe('Undo #2 on a.md')
  await click('Put back in Main')
  expect(revertCommit).toHaveBeenCalledWith('c2', 2, 'a.md', 'Undo #2 on a.md')
  expect(toast).toHaveBeenLastCalledWith('Undid #2 on a.md')
})

it('keeps the default revert message within the commit message limit', async () => {
  historyFixture()
  vi.mocked(listCommits).mockResolvedValue([commit(2, 'x'.repeat(2000)), commit(1, 'First draft')] as never)
  await showHistory(committer)
  await expand('x'.repeat(2000))
  await click('Revert commit', host!)
  expect((document.getElementById('put-back-message') as HTMLInputElement).value).toHaveLength(2000)
})

it('offers a member without commit_main the draft actions', async () => {
  historyFixture()
  await showHistory(drafter)
  await expand('Second pass')
  expect(buttons()).toContain('Revert in my draft')
  expect(buttons()).toContain('Undo in my draft')
  expect(buttons()).not.toContain('Revert commit')
  expect(buttons()).not.toContain('Undo this change')
})

it('puts the version before the commit into the draft', async () => {
  historyFixture()
  await showHistory(drafter)
  await expand('Second pass')
  await click('Undo in my draft', host!)
  await click('Put back in my draft')
  expect(restoreToDraft).toHaveBeenCalledWith({
    repoId: 'repo',
    projectId: 'p',
    path: 'a.md',
    target: expect.objectContaining({ seq: 1, content: 'v1' }),
    current: expect.objectContaining({ seq: 2 }),
  })
  expect(toast).toHaveBeenLastCalledWith('Undid #2 on a.md in your draft')
})

it('offers a stakeholder, a class teacher and a read-only viewer no revert', async () => {
  for (const state of [
    { ...viewer, myRole: 'stakeholder', readOnly: false },
    { ...viewer, myRole: null, readOnly: true, classTeacher: true },
    viewer,
  ] as unknown as GeneralProjectState[]) {
    historyFixture()
    await showHistory(state)
    await expand('Second pass')
    expect(host!.textContent).toContain('a.md')
    for (const label of ['Revert commit', 'Undo this change', 'Revert in my draft', 'Undo in my draft']) {
      expect(buttons()).not.toContain(label)
    }
    await act(async () => root!.unmount())
    host!.remove()
    root = null
  }
})

it('shows where a revert came from', async () => {
  historyFixture()
  vi.mocked(listCommits).mockResolvedValue([commit(3, 'Revert #2: Second pass'), commit(2, 'Second pass')] as never)
  vi.mocked(commitOrigins).mockResolvedValue({
    c3: { commit_id: 'c3', project_id: 'p', kind: 'revert', source_commit_id: 'c2', source_seq: 2, path: null, created_at: '2026-11-15T00:00:00Z' },
  })
  await showHistory(committer)
  expect(host!.textContent).toContain('Reverts #2')
  await click('Reverts #2', host!)
  expect(host!.querySelector('button[aria-expanded="true"]')?.textContent).toContain('Second pass')
})

it('keeps History when the origins fail to load', async () => {
  historyFixture()
  vi.mocked(commitOrigins).mockRejectedValue(new Error('no'))
  await showHistory(committer)
  expect(host!.textContent).toContain('Second pass')
})

it('says a one-file undo in the draft has nothing to undo, naming the file', async () => {
  historyFixture()
  vi.mocked(fileVersions).mockResolvedValue([
    { ...blob(2, 'a.md', 'changed', 'v1'), commit: commit(2, 'Second pass') },
    { ...blob(1, 'a.md', 'added'), commit: commit(1, 'First draft') },
  ] as never)
  await showHistory(drafter)
  await expand('Second pass')
  await click('Undo in my draft', host!)
  await click('Put back in my draft')
  expect(restoreToDraft).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('Nothing to undo. a.md is already as it was before #2.')
})

it('asks before replacing a draft copy', async () => {
  historyFixture()
  vi.mocked(listDraftFiles).mockResolvedValue([{ id: 'd', draft_id: 'draft', path: 'a.md', action: 'changed', kind: 'text', content: 'mine', storage_path: null }] as never)
  await showHistory(drafter)
  await expand('Second pass')
  await click('Undo in my draft', host!)
  expect(document.querySelector('[data-replaces-draft]')?.textContent).toContain('a.md')
  await click('Cancel')
  expect(restoreToDraft).not.toHaveBeenCalled()
  expect(document.querySelector('[data-replaces-draft]')).toBeNull()
})

it('names the files a later commit changed and offers only Close', async () => {
  historyFixture()
  vi.mocked(fileVersions).mockResolvedValue([
    { ...blob(3, 'a.md'), commit: commit(3, 'Third pass') },
    { ...blob(2, 'a.md'), commit: commit(2, 'Second pass') },
  ] as never)
  await showHistory(committer)
  await expand('Second pass')
  await click('Revert commit', host!)
  expect(document.querySelector('[data-changed-since]')?.textContent).toContain('a.md')
  expect([...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Put back in Main')).toBe(false)
  expect(revertCommit).not.toHaveBeenCalled()
})

it('says which files reached the draft when a revert stops part-way, and retries only the rest', async () => {
  historyFixture()
  vi.mocked(listTree).mockResolvedValue([{ ...blob(2, 'a.md'), size: 2 }, { ...blob(2, 'b.md'), size: 2 }] as never)
  vi.mocked(listCommitFiles).mockResolvedValue([blob(2, 'a.md'), blob(2, 'b.md')] as never)
  vi.mocked(fileVersions).mockImplementation(async (_repo, path) => [
    { ...blob(2, path), commit: commit(2, 'Second pass') },
    { ...blob(1, path, 'added'), commit: commit(1, 'First draft') },
  ] as never)
  vi.mocked(restoreToDraft).mockResolvedValueOnce(undefined).mockRejectedValueOnce({ message: 'Storage is full.' })
  await showHistory(drafter)
  await expand('Second pass')
  await click('Revert in my draft', host!)
  await click('Put back in my draft')
  expect(document.body.textContent).toContain(
    'a.md is back in your draft. b.md did not go through: Storage is full. Try again to put back the rest.',
  )
  await click('Put back in my draft')
  expect(vi.mocked(restoreToDraft).mock.calls.map(([input]) => input.path)).toEqual(['a.md', 'b.md', 'b.md'])
})
