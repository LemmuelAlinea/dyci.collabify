// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FileHistoryPanel } from './FileHistoryPanel'
import { fileVersions, restoreFile, restoreToDraft, revertCommit } from '../../lib/api/fileHistory'
import type { GeneralDraftFile } from '../../lib/general/types'
import type { GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
const toast = vi.hoisted(() => vi.fn())
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: toast }) }))
vi.mock('./WordDiff', () => ({ WordDiff: () => null }))
vi.mock('./ExcelDiff', () => ({ ExcelDiff: () => null }))
vi.mock('../../lib/api/general', () => ({
  contentAt: vi.fn(async () => ''),
  storagePathAt: vi.fn(async () => null),
  excelSourceAt: vi.fn(async () => null),
}))
vi.mock('../../lib/api/fileHistory', () => ({
  fileVersions: vi.fn(async () => []),
  restoreFile: vi.fn(async () => ({ seq: 4 })),
  revertCommit: vi.fn(async () => ({ seq: 4 })),
  restoreToDraft: vi.fn(async () => {}),
}))

const repo = { id: 'repo', project_id: 'p', name: 'Files', file_count: 1, commit_count: 3, last_author: null, last_commit_at: null }
const commit = (seq: number, message: string, author: string | null = 'Ana') => ({
  id: `c${seq}`, repo_id: 'repo', project_id: 'p', seq, message, author_id: author, change_id: null, created_at: '2026-11-14T00:00:00Z',
})
const version = (seq: number, action: string, message: string, content = `v${seq}`) => ({
  id: `a.md@${seq}`, commit_id: `c${seq}`, repo_id: 'repo', project_id: 'p', seq, path: 'a.md', action, kind: 'text',
  content: action === 'removed' ? '' : content, storage_path: null, created_at: '2026-11-14T00:00:00Z',
  commit: commit(seq, message, seq === 2 ? 'Ben' : 'Ana'),
})

/** a.md: added at #1, removed at #2, added again at #3 (current). */
const VERSIONS = [
  version(3, 'added', 'Bring the notes back'),
  version(2, 'removed', 'Tidy the folder'),
  version(1, 'added', 'First notes'),
]

const base = {
  project: { id: 'p', class_board_id: null },
  myRole: 'member', readOnly: false, viewerId: 'me',
  can: () => false,
  nameOf: (id: string) => id,
}
const committer = { ...base, can: (p: string) => p === 'commit_main' } as unknown as GeneralProjectState
const drafter = base as unknown as GeneralProjectState

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null
const onDone = vi.fn()
const onClose = vi.fn()

beforeEach(() => {
  vi.mocked(fileVersions).mockResolvedValue(VERSIONS as never)
})

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = null
  root = null
  vi.clearAllMocks()
})

async function show(state: GeneralProjectState, draftFiles: GeneralDraftFile[] = [], dirty = false) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <FileHistoryPanel repo={repo as never} path="a.md" state={state} draftFiles={draftFiles} dirty={dirty} onDone={onDone} onClose={onClose} />,
    ),
  )
}

const rows = () => [...host!.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')]
const buttons = () => [...document.querySelectorAll('button')].map((b) => b.textContent?.trim())
async function expand(seq: number) {
  await act(async () => rows().find((b) => b.textContent?.includes(`#${seq}`))!.click())
}
const click = async (label: string) =>
  act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label)!.click())

it('lists the versions newest first with their number, message, author and action, the newest marked Current', async () => {
  await show(committer)
  expect(fileVersions).toHaveBeenCalledWith('repo', 'a.md')
  const list = rows()
  expect(list.map((r) => r.textContent?.match(/#\d+/)?.[0])).toEqual(['#3', '#2', '#1'])
  expect(list[0].textContent).toContain('Bring the notes back')
  expect(list[0].textContent).toContain('Ana')
  expect(list[0].textContent).toContain('Added')
  expect(list[0].textContent).toContain('Current')
  expect(list[1].textContent).toContain('Tidy the folder')
  expect(list[1].textContent).toContain('Ben')
  expect(list[1].textContent).toContain('Removed')
  expect(list[1].textContent).not.toContain('Current')
  expect(list[2].textContent).not.toContain('Current')
})

it('offers a committer Restore this version on an older live version and Undo this change on every version', async () => {
  await show(committer)
  await expand(1)
  expect(buttons()).toContain('Restore this version')
  expect(buttons()).toContain('Undo this change')
  expect(buttons()).not.toContain('Restore to my draft')
  await expand(3)
  expect(buttons()).not.toContain('Restore this version')
  expect(buttons()).toContain('Undo this change')
})

it('offers no restore on a removal', async () => {
  await show(committer)
  await expand(2)
  expect(buttons()).not.toContain('Restore this version')
  expect(buttons()).toContain('Undo this change')
})

it('offers someone without commit_main the draft actions', async () => {
  await show(drafter)
  await expand(1)
  expect(buttons()).toContain('Restore to my draft')
  expect(buttons()).toContain('Undo in my draft')
  expect(buttons()).not.toContain('Restore this version')
  expect(buttons()).not.toContain('Undo this change')
})

it('offers a stakeholder, a class teacher and a read-only viewer no actions', async () => {
  for (const state of [
    { ...base, myRole: 'stakeholder', readOnly: true },
    { ...base, myRole: null, readOnly: true, classTeacher: true },
    { ...base, myRole: null, readOnly: true },
  ] as unknown as GeneralProjectState[]) {
    await show(state)
    await expand(1)
    expect(host!.textContent).toContain('First notes')
    for (const label of ['Restore this version', 'Undo this change', 'Restore to my draft', 'Undo in my draft']) {
      expect(buttons()).not.toContain(label)
    }
    await act(async () => root!.unmount())
    host!.remove()
    root = null
  }
})

it('restores a version into Main with the repo base and the default message', async () => {
  await show(committer)
  await expand(1)
  await click('Restore this version')
  expect(document.body.textContent).toContain('Restore a.md to #1?')
  expect((document.getElementById('put-back-message') as HTMLInputElement).value).toBe('Restore a.md to #1')
  await click('Put back in Main')
  expect(restoreFile).toHaveBeenCalledWith('repo', 'a.md', 1, 3, 'Restore a.md to #1')
  expect(onDone).toHaveBeenCalled()
})

it('restores a version into the draft, naming the draft copy it replaces', async () => {
  await show(drafter, [{ id: 'd', draft_id: 'draft', path: 'a.md', action: 'changed', kind: 'text', content: 'mine', storage_path: null }] as never)
  await expand(1)
  await click('Restore to my draft')
  expect(document.querySelector('[data-replaces-draft]')?.textContent).toContain('a.md')
  await click('Put back in my draft')
  expect(restoreToDraft).toHaveBeenCalledWith({
    repoId: 'repo',
    projectId: 'p',
    path: 'a.md',
    target: expect.objectContaining({ seq: 1, content: 'v1' }),
    current: expect.objectContaining({ seq: 3, action: 'added' }),
  })
  expect(onDone).toHaveBeenCalled()
})

it('undoes the newest version in Main with the path', async () => {
  await show(committer)
  await expand(3)
  await click('Undo this change')
  expect((document.getElementById('put-back-message') as HTMLInputElement).value).toBe('Undo #3 on a.md')
  await click('Put back in Main')
  expect(revertCommit).toHaveBeenCalledWith('c3', 3, 'a.md', 'Undo #3 on a.md')
  expect(toast).toHaveBeenLastCalledWith('Undid #3 on a.md')
  expect(onDone).toHaveBeenCalled()
})

it('names the later edits on an older undo and offers only Close', async () => {
  await show(committer)
  await expand(1)
  await click('Undo this change')
  expect(document.querySelector('[data-changed-since]')?.textContent).toContain('a.md')
  expect(buttons()).not.toContain('Put back in Main')
  expect(buttons()).toContain('Close')
  expect(revertCommit).not.toHaveBeenCalled()
})

it('says when the file history did not load', async () => {
  vi.mocked(fileVersions).mockRejectedValueOnce(new Error('no'))
  await show(committer)
  expect(host!.textContent).toContain('The file history did not load.')
  expect(rows()).toHaveLength(0)
})

it('closes from its own close button', async () => {
  await show(committer)
  await act(async () => host!.querySelector<HTMLButtonElement>('button[aria-label="Close the history"]')!.click())
  expect(onClose).toHaveBeenCalled()
})

it("warns that a restore drops the open file's unsaved edits, only when there are some", async () => {
  await show(committer, [], true)
  await expand(1)
  await click("Restore this version")
  expect(document.querySelector("[data-drops-unsaved]")?.textContent).toBe("Your unsaved changes in this file are dropped.")
  await click("Cancel")
  await expand(3)
  await click("Undo this change")
  expect(document.querySelector("[data-drops-unsaved]")).not.toBeNull()
  await act(async () => root!.unmount())
  host!.remove()
  root = null
  await show(committer)
  await expand(1)
  await click("Restore this version")
  expect(document.querySelector("[data-drops-unsaved]")).toBeNull()
})
