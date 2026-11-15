// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DraftPanel, heldFolderReason } from './DraftPanel'
import type { GeneralDraftFile } from '../../lib/general/types'
import type { GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const m = vi.hoisted(() => ({
  baseOf: vi.fn(),
  recordBase: vi.fn(),
  endPull: vi.fn(),
  pullFile: vi.fn(),
  saveDraft: vi.fn(),
  commitPath: vi.fn(),
  at: vi.fn(),
  url: vi.fn(),
  copy: vi.fn(),
  confirmError: null as unknown,
}))

vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('./WordDiff', () => ({ WordDiff: () => null }))
vi.mock('./ShareDialog', () => ({ ShareDialog: () => null }))
vi.mock('../ui/Modal', () => ({
  Modal: (p: { open: boolean; title: string; children: ReactNode }) =>
    p.open ? <div data-modal={p.title}>{p.title}{p.children}</div> : null,
}))
vi.mock('../ui/ConfirmDialog', () => ({
  ConfirmDialog: (p: { open: boolean; title: string; body: ReactNode; confirmLabel: string; onConfirm: () => Promise<void> | void; onClose: () => void }) =>
    p.open ? (
      <div data-dialog={p.title}>
        {p.body}
        <button
          type="button"
          data-confirm
          onClick={async () => {
            try {
              await p.onConfirm()
              p.onClose()
            } catch (err) {
              m.confirmError = err
            }
          }}
        >
          {p.confirmLabel}
        </button>
      </div>
    ) : null,
}))
vi.mock('../../lib/api/filePulls', () => ({
  baseOf: m.baseOf,
  recordBase: m.recordBase,
  endPull: m.endPull,
  pullFile: m.pullFile,
  listPulls: vi.fn(async () => []),
}))
vi.mock('../../lib/api/general', () => ({
  archiveDraftPath: vi.fn(),
  commitDraftPath: m.commitPath,
  discardDraft: vi.fn(),
  submitDraftFolder: vi.fn(),
  submitDraftFile: vi.fn(),
  syncDraft: vi.fn(),
  saveDraftFile: m.saveDraft,
  storagePathAt: m.at,
  projectFileUrl: m.url,
  copyProjectFile: m.copy,
}))
vi.mock('../../lib/api/trash', () => ({ trashDraftPath: vi.fn() }))
vi.mock('../../lib/api/workAi', () => ({ writeChangeMessage: vi.fn() }))

const repo = { id: 'repo', name: 'Files', file_count: 1, commit_count: 6, last_author: null, last_commit_at: null }
const state = {
  project: { id: 'p', class_board_id: null },
  myRole: 'member',
  readOnly: false,
  viewerId: 'me',
  members: [],
  commitRights: { committers: [] },
  can: () => false,
  nameOf: (id: string) => (id === 'ben' ? 'Ben' : 'A former member'),
} as unknown as GeneralProjectState

const row = (over: Partial<GeneralDraftFile> = {}) =>
  ({
    id: 'f',
    draft_id: 'd',
    project_id: 'p',
    path: 'Chap1-4.docx',
    action: 'changed',
    kind: 'binary',
    content: '',
    storage_path: 'p/files/mine.docx',
    updated_at: '',
    archived_at: null,
    archived_by: null,
    ...over,
  }) as GeneralDraftFile

const HELD = { base_seq: 4, main_seq: 6, main_author: 'ben', main_at: null, main_removed: false }

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null
const onDone = vi.fn(async () => {})

const open = vi.fn()
let tab: { location: { href: string }; close: () => void; opener: unknown }

beforeEach(() => {
  tab = { location: { href: '' }, close: vi.fn(), opener: {} }
  open.mockReturnValue(tab)
  vi.stubGlobal('open', open)
  m.baseOf.mockResolvedValue(null)
  m.recordBase.mockResolvedValue(undefined)
  m.pullFile.mockResolvedValue({})
  m.at.mockResolvedValue('p/files/ben.docx')
  m.url.mockResolvedValue('https://signed/ben')
  m.endPull.mockResolvedValue(undefined)
  m.saveDraft.mockResolvedValue({})
  m.copy.mockResolvedValue('p/files/mine-copy.docx')
  m.confirmError = null
})

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = null
  root = null
  document.body.replaceChildren()
  vi.clearAllMocks()
})

function panel(files: GeneralDraftFile[], path = '', inMain = true) {
  return (
    <DraftPanel
      draft={{ id: 'd', base_seq: 6 } as never}
      files={files}
      conflicts={[]}
      repo={repo as never}
      state={state}
      mainOf={() => ''}
      mainStorageOf={() => (inMain ? 'p/files/main.docx' : null)}
      mainAtOf={() => null}
      path={path}
      onNavigate={vi.fn()}
      onRename={vi.fn()}
      onOpen={vi.fn()}
      onDone={onDone}
    />
  )
}

async function show(files: GeneralDraftFile[], path = '', inMain = true) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(panel(files, path, inMain)))
}

const button = (label: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!
const menuItem = (label: string) =>
  [...document.body.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.trim().startsWith(label)) as HTMLButtonElement
async function openMenu(name: string) {
  await act(async () => (document.body.querySelector(`button[aria-label="Actions for ${name}"]`) as HTMLElement).click())
}

it("holds a Word copy by its own recorded base, with the same message as the upload", async () => {
  m.baseOf.mockResolvedValue(HELD)
  await show([row()])
  expect(m.baseOf).toHaveBeenCalledWith('p/files/mine.docx')
  expect(host!.textContent).toContain('Ben updated this since you pulled')
  expect(button("Download Ben's version")).toBeTruthy()
})

it('holds an Excel copy the same way and says to combine the two in Excel', async () => {
  m.baseOf.mockResolvedValue(HELD)
  await show([row({ path: 'Budget.xlsx', storage_path: 'p/files/mine.xlsx' })])
  expect(m.baseOf).toHaveBeenCalledWith('p/files/mine.xlsx')
  expect(host!.textContent).toContain('Ben updated this since you pulled')
  expect(host!.textContent).toContain('combine the two in Excel, then upload the result here.')
  await act(async () => button("Download Ben's version").click())
  expect(m.pullFile).toHaveBeenCalledWith('repo', 'Budget.xlsx', true)
})

it('does not check a removal or a file that is not Word', async () => {
  await show([row({ action: 'removed', storage_path: null }), row({ path: 'Notes.pdf', storage_path: 'p/files/n.pdf' })])
  expect(m.baseOf).not.toHaveBeenCalled()
})

it('shows nothing for a copy whose base is Main', async () => {
  m.baseOf.mockResolvedValue({ ...HELD, base_seq: 6 })
  await show([row()])
  expect(host!.textContent).not.toContain('since you pulled')
})

it('replaces a removed file by recording Main as its base, then saving the row as added and ending the pull', async () => {
  m.baseOf.mockResolvedValue({ ...HELD, main_removed: true })
  await show([row()])
  expect(host!.textContent).toContain('Ben removed this file since you pulled')
  await act(async () => button('Replace it anyway').click())
  await act(async () => (document.body.querySelector('[data-dialog^="Put the file back"] [data-confirm]') as HTMLElement).click())
  expect(m.recordBase).toHaveBeenCalledWith('repo', 'Chap1-4.docx', 'p/files/mine.docx', 6)
  expect(m.saveDraft).toHaveBeenCalledWith({
    repoId: 'repo',
    path: 'Chap1-4.docx',
    action: 'added',
    kind: 'binary',
    storagePath: 'p/files/mine.docx',
  })
  expect(m.endPull).toHaveBeenCalledWith('repo', 'Chap1-4.docx')
  expect(m.recordBase.mock.invocationCallOrder[0]).toBeLessThan(m.endPull.mock.invocationCallOrder[0])
})

const OTHERS = {
  message: "Only whoever uploaded that copy can say which version it was made from. Download it, then upload it here as a new version.",
}

async function replaceIt() {
  await act(async () => button('Replace it anyway').click())
  await act(async () => (document.body.querySelector('[data-dialog^="Replace"] [data-confirm]') as HTMLElement).click())
}

it("copies a shared copy to the person's own object before recording its base", async () => {
  m.baseOf.mockResolvedValue(HELD)
  m.recordBase.mockRejectedValueOnce(OTHERS).mockResolvedValue(undefined)
  await show([row()])
  await replaceIt()
  expect(m.copy).toHaveBeenCalledWith('p', 'p/files/mine.docx')
  expect(m.recordBase).toHaveBeenLastCalledWith('repo', 'Chap1-4.docx', 'p/files/mine-copy.docx', 6)
  expect(m.saveDraft).toHaveBeenCalledWith({
    repoId: 'repo',
    path: 'Chap1-4.docx',
    action: 'changed',
    kind: 'binary',
    storagePath: 'p/files/mine-copy.docx',
  })
  expect(m.recordBase.mock.invocationCallOrder[1]).toBeLessThan(m.saveDraft.mock.invocationCallOrder[0])
  expect(m.confirmError).toBeNull()
})

it('says what to do when a shared copy cannot be copied', async () => {
  m.baseOf.mockResolvedValue(HELD)
  m.recordBase.mockRejectedValue(OTHERS)
  m.copy.mockRejectedValue({ message: 'new row violates row-level security policy' })
  await show([row()])
  await replaceIt()
  expect((m.confirmError as Error).message).toContain('Download it, then upload it here as a new version.')
  expect(m.saveDraft).not.toHaveBeenCalled()
  expect(m.endPull).not.toHaveBeenCalled()
})

it("saves nothing again when the copy is already the person's own", async () => {
  m.baseOf.mockResolvedValue(HELD)
  await show([row()])
  await replaceIt()
  expect(m.recordBase).toHaveBeenCalledWith('repo', 'Chap1-4.docx', 'p/files/mine.docx', 6)
  expect(m.copy).not.toHaveBeenCalled()
  expect(m.saveDraft).not.toHaveBeenCalled()
})

it('keeps Submit off until the check of a Word copy comes back', async () => {
  let answer: (v: unknown) => void = () => {}
  m.baseOf.mockReturnValue(new Promise((r) => (answer = r)))
  await show([row()])
  await openMenu('Chap1-4.docx')
  expect(menuItem('Submit for review').disabled).toBe(true)
  await act(async () => answer(null))
  expect(menuItem('Submit for review').disabled).toBe(false)
})

it("keeps the row held after their version is downloaded, since the copy's base has not moved", async () => {
  m.baseOf.mockResolvedValue(HELD)
  await show([row()])
  await act(async () => button("Download Ben's version").click())
  expect(m.pullFile).toHaveBeenCalledWith('repo', 'Chap1-4.docx', true)
  expect(open).toHaveBeenCalledWith('', '_blank')
  expect(tab.location.href).toBe('https://signed/ben')
  expect(host!.textContent).toContain('Held')
  // A combined copy uploaded from the fresh pull carries Main's version as its base.
  m.baseOf.mockResolvedValue({ ...HELD, base_seq: 6 })
  await act(async () => root!.render(panel([row({ storage_path: 'p/files/combined.docx' })])))
  expect(m.baseOf).toHaveBeenLastCalledWith('p/files/combined.docx')
  expect(host!.textContent).not.toContain('Held')
})

it('offers a link in the row when the browser blocks the download', async () => {
  open.mockReturnValue(null)
  m.baseOf.mockResolvedValue(HELD)
  await show([row()])
  await act(async () => button("Download Ben's version").click())
  expect(host!.querySelector('a[href="https://signed/ben"]')).toBeTruthy()
})

it('keeps the hold when the panel opens again, with nothing kept in the browser', async () => {
  m.baseOf.mockResolvedValue(HELD)
  await show([row()])
  await act(async () => root!.unmount())
  root = createRoot(host!)
  await act(async () => root!.render(panel([row()])))
  expect(host!.textContent).toContain('Ben updated this since you pulled')
  expect(sessionStorage.length).toBe(0)
})

it('disables Submit for a held row', async () => {
  m.baseOf.mockResolvedValue(HELD)
  await show([row()])
  await openMenu('Chap1-4.docx')
  expect(menuItem('Submit for review').disabled).toBe(true)
})

it('warns before submitting a Word copy with no base on record, and continues on request', async () => {
  await show([row()])
  await openMenu('Chap1-4.docx')
  await act(async () => menuItem('Submit for review').click())
  expect(document.body.textContent).toContain("Collabify doesn't know which copy you started from.")
  expect(document.body.querySelector('[data-modal="Submit this file"]')).toBeNull()
  await act(async () => (document.body.querySelector('[data-dialog] [data-confirm]') as HTMLElement).click())
  expect(document.body.querySelector('[data-modal="Submit this file"]')).not.toBeNull()
})

it('asks nothing for a new Word file Main has never had', async () => {
  await show([row({ action: 'added' })], '', false)
  await openMenu('Chap1-4.docx')
  await act(async () => menuItem('Submit for review').click())
  expect(document.body.textContent).not.toContain("doesn't know which copy")
  expect(document.body.querySelector('[data-modal="Submit this file"]')).not.toBeNull()
})

it('disables Submit and Commit for a folder that carries a held Word file, and says why', async () => {
  m.baseOf.mockResolvedValue(HELD)
  await show([row({ path: 'Thesis/Chap1-4.docx' }), row({ id: 'g', path: 'Thesis/notes.md', kind: 'text', storage_path: null })])
  await openMenu('Thesis')
  const submit = menuItem('Submit for review')
  expect(submit.disabled).toBe(true)
  expect(submit.textContent).toContain("Chap1-4.docx is held. Combine it with Main's newer version or replace it first.")
})

it('disables the open folder bar actions the same way', async () => {
  m.baseOf.mockResolvedValue(HELD)
  await show([row({ path: 'Thesis/Chap1-4.docx' })], 'Thesis')
  await openMenu('Thesis')
  expect(menuItem('Submit for review').disabled).toBe(true)
})

describe('heldFolderReason', () => {
  const v = { kind: 'held', by: null, at: null, removed: false, mainSeq: 2, baseSeq: 1 } as const
  it('names one held file, counts several and ignores other folders', () => {
    expect(heldFolderReason('A', { 'A/x.docx': v })).toContain('x.docx is held')
    expect(heldFolderReason('A', { 'A/x.docx': v, 'A/B/y.docx': v })).toContain('2 Word files in it are held')
    expect(heldFolderReason('A', { 'AB/x.docx': v })).toBeNull()
    expect(heldFolderReason('A', { 'A/x.xlsx': v, 'A/y.xls': v })).toContain('2 Excel files in it are held')
    expect(heldFolderReason('A', { 'A/x.xlsx': v, 'A/y.docx': v })).toContain('2 files in it are held')
  })
})
