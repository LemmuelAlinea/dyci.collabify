// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NewItemDialog } from './NewItemDialog'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const m = vi.hoisted(() => ({
  toast: vi.fn(),
  endPull: vi.fn(),
  pullFile: vi.fn(),
  pushState: vi.fn(),
  recordBase: vi.fn(),
  mainSeq: vi.fn(),
  upload: vi.fn(),
  saveDraft: vi.fn(),
  at: vi.fn(),
  url: vi.fn(),
}))

vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: m.toast }) }))
vi.mock('./WordDiff', () => ({ WordDiff: () => null }))
vi.mock('../ui/ConfirmDialog', () => ({
  ConfirmDialog: (p: { open: boolean; confirmLabel: string; onConfirm: () => Promise<void>; body: ReactNode }) =>
    p.open ? (
      <button type="button" onClick={() => void p.onConfirm()}>
        {p.confirmLabel}
      </button>
    ) : null,
}))
vi.mock('../../lib/api/filePulls', () => ({
  endPull: m.endPull,
  pushState: m.pushState,
  pullFile: m.pullFile,
  recordBase: m.recordBase,
  mainSeq: m.mainSeq,
}))
vi.mock('../../lib/api/general', () => ({
  uploadProjectFile: m.upload,
  saveDraftFile: m.saveDraft,
  storagePathAt: m.at,
  projectFileUrl: m.url,
}))

const repo = { id: 'repo', project_id: 'p', name: 'Files', file_count: 2, commit_count: 4, last_author: null, last_commit_at: null }
const tree = [
  { path: 'Chap1-4.docx', kind: 'binary', content: '', storage_path: 's/a.docx' },
  { path: 'Thesis/Chap2.docx', kind: 'binary', content: '', storage_path: 's/b.docx' },
  { path: 'Thesis/notes.txt', kind: 'text', content: 'x', storage_path: null },
  { path: 'notes.md', kind: 'text', content: 'x', storage_path: null },
] as never

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
const onDone = vi.fn(async () => {})

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  m.upload.mockResolvedValue('p/files/new.docx')
  m.saveDraft.mockResolvedValue({})
  m.endPull.mockResolvedValue(undefined)
  m.pullFile.mockResolvedValue({})
  m.at.mockResolvedValue('s/main6.docx')
  m.url.mockResolvedValue('https://signed/url')
  vi.stubGlobal('open', vi.fn(() => ({ location: { href: '' }, close: vi.fn(), opener: {} })))
  m.pushState.mockResolvedValue({ main_seq: 4, base_seq: 4, main_author: null, main_at: null, main_removed: false })
  m.recordBase.mockResolvedValue(undefined)
  m.mainSeq.mockResolvedValue(7)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

async function render(draft: never[] = [], folder = '') {
  await act(async () =>
    root.render(
      <NewItemDialog open onClose={() => {}} repo={repo as never} tree={tree} draftFiles={draft} folder={folder} onDone={onDone} />,
    ),
  )
}
const text = () => document.body.textContent ?? ''
const button = (label: string) => {
  const hit = [...document.body.querySelectorAll('button')].find((b) => (b.textContent?.trim() === label || b.textContent?.trim().startsWith(label + 'Add') || b.textContent?.trim().startsWith(label + 'Make')))
  if (!hit) throw new Error(`No button ${label}: ${text()}`)
  return hit
}
const click = (label: string) => act(async () => button(label).click())

async function pickFiles(files: File[], rel?: string[]) {
  const input = document.body.querySelector('input[type="file"]') as HTMLInputElement
  files.forEach((f, i) => rel && Object.defineProperty(f, 'webkitRelativePath', { value: rel[i] }))
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
const doc = (name: string) => new File([new Uint8Array(4)], name)

it('offers a new version when the picked name is already in Main', async () => {
  await render()
  await click('Upload a file')
  await pickFiles([doc('Chap1-4.docx')])
  await click('Add to my draft')
  expect(text()).toContain('Chap1-4.docx is already here')
  expect(button('Upload as a new version')).toBeTruthy()
  expect(button('Rename')).toBeTruthy()
  expect(m.saveDraft).not.toHaveBeenCalled()
})

it('saves the new version as changed after Upload as a new version', async () => {
  await render()
  await click('Upload a file')
  await pickFiles([doc('Chap1-4.docx')])
  await click('Add to my draft')
  await click('Upload as a new version')
  expect(m.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ path: 'Chap1-4.docx', action: 'changed', kind: 'binary' }))
  expect(m.recordBase).toHaveBeenCalledWith('repo', 'Chap1-4.docx', 'p/files/new.docx', 4)
  expect(m.recordBase.mock.invocationCallOrder[0]).toBeLessThan(m.saveDraft.mock.invocationCallOrder[0])
  expect(m.endPull).not.toHaveBeenCalled()
})

it("records Main's version as the base of a new Word file", async () => {
  await render()
  await click('Upload a file')
  await pickFiles([doc('Chap5.docx')])
  await click('Add to my draft')
  expect(m.pushState).not.toHaveBeenCalled()
  expect(m.mainSeq).toHaveBeenCalledWith('repo', 'Chap5.docx')
  expect(m.recordBase).toHaveBeenCalledWith('repo', 'Chap5.docx', 'p/files/new.docx', 7)
  expect(m.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ path: 'Chap5.docx', action: 'added' }))
})

it('records no base for an upload that is not Word', async () => {
  await render()
  await click('Upload a file')
  await pickFiles([doc('Scan.pdf')])
  await click('Add to my draft')
  expect(m.saveDraft).toHaveBeenCalled()
  expect(m.recordBase).not.toHaveBeenCalled()
})

it('asks once for a folder with two existing names and saves nothing on Cancel', async () => {
  await render()
  await click('Upload a folder')
  await pickFiles([doc('Chap1-4.docx'), doc('Chap2.docx'), doc('new.pdf')], ['Chap1-4.docx', 'Thesis/Chap2.docx', 'new.pdf'])
  await click('Add to my draft')
  expect(text()).toContain('Upload 2 files as new versions?')
  expect(m.saveDraft).not.toHaveBeenCalled()
  await click('Cancel')
  expect(m.saveDraft).not.toHaveBeenCalled()
  expect(m.upload).not.toHaveBeenCalled()
})

it('holds a Word upload from a copy Main has moved past', async () => {
  m.pushState.mockResolvedValue({ main_seq: 6, base_seq: 4, main_author: 'ana', main_at: '2026-11-14T02:00:00Z', main_removed: false })
  await render()
  await click('Upload a file')
  await pickFiles([doc('Chap1-4.docx')])
  await click('Add to my draft')
  await click('Upload as a new version')
  expect(text()).toContain('updated this since you pulled')
  expect(button('Replace it anyway')).toBeTruthy()
  expect(m.saveDraft).not.toHaveBeenCalled()
})

it('keeps refusing an existing text file', async () => {
  await render([], 'Thesis')
  await click('Upload a file')
  await pickFiles([new File(['hi'], 'notes.txt')])
  await click('Add to my draft')
  expect(text()).toContain('already has a file with that name')
  expect(m.saveDraft).not.toHaveBeenCalled()
})

const HELD = { main_seq: 6, base_seq: 4, main_author: 'ana', main_at: '2026-11-14T02:00:00Z', main_removed: false }

async function heldDialog() {
  m.pushState.mockResolvedValue(HELD)
  await render()
  await click('Upload a file')
  await pickFiles([doc('Chap1-4.docx')])
  await click('Add to my draft')
  await click('Upload as a new version')
}

it('drops the picked file after Download their version and saves nothing', async () => {
  await heldDialog()
  await click("Download Someone's version")
  expect(m.pullFile).toHaveBeenCalled()
  m.pushState.mockResolvedValue({ ...HELD, base_seq: 6 })
  expect(text()).toContain('You have the newer version now')
  await click('Add to my draft')
  expect(text()).toContain('Choose a file from your computer.')
  expect(m.saveDraft).not.toHaveBeenCalled()
  expect(m.upload).not.toHaveBeenCalled()
})

it('disables Add to my draft while the upload is held', async () => {
  await heldDialog()
  expect((button('Add to my draft') as HTMLButtonElement).disabled).toBe(true)
})

it("saves after Replace it anyway as made from Main's version, then ends the pull", async () => {
  await heldDialog()
  await click('Replace it anyway')
  await click('Replace it')
  expect(m.recordBase).toHaveBeenCalledWith('repo', 'Chap1-4.docx', 'p/files/new.docx', 7)
  expect(m.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ path: 'Chap1-4.docx', action: 'changed' }))
  expect(m.endPull).toHaveBeenCalledWith('repo', 'Chap1-4.docx')
  expect(m.saveDraft.mock.invocationCallOrder[0]).toBeLessThan(m.endPull.mock.invocationCallOrder[0])
})

it('keeps the pull when Replace it anyway fails to save', async () => {
  await heldDialog()
  m.saveDraft.mockRejectedValue({ message: 'Could not reach the server' })
  await click('Replace it anyway')
  await click('Replace it')
  expect(m.endPull).not.toHaveBeenCalled()
})

it('saves after Continue when the copy it started from is unknown', async () => {
  m.pushState.mockResolvedValue(null)
  await render()
  await click('Upload a file')
  await pickFiles([doc('Chap1-4.docx')])
  await click('Add to my draft')
  await click('Upload as a new version')
  expect(text()).toContain("doesn't know which copy")
  expect(m.saveDraft).not.toHaveBeenCalled()
  await click('Continue')
  expect(m.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ path: 'Chap1-4.docx', action: 'changed' }))
  expect(m.recordBase).toHaveBeenCalledWith('repo', 'Chap1-4.docx', 'p/files/new.docx', 7)
})
