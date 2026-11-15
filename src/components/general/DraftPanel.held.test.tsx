// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DraftPanel } from './DraftPanel'
import type { GeneralDraftFile } from '../../lib/general/types'
import type { GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const m = vi.hoisted(() => ({
  pushState: vi.fn(),
  endPull: vi.fn(),
  pullFile: vi.fn(),
  saveDraft: vi.fn(),
  commitPath: vi.fn(),
  at: vi.fn(),
  url: vi.fn(),
}))

vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('./WordDiff', () => ({ WordDiff: () => null }))
vi.mock('./ShareDialog', () => ({ ShareDialog: () => null }))
vi.mock('../ui/ConfirmDialog', () => ({
  ConfirmDialog: (p: { open: boolean; title: string; body: ReactNode; confirmLabel: string; onConfirm: () => Promise<void> }) =>
    p.open ? (
      <div data-dialog={p.title}>
        <button type="button" data-confirm onClick={() => void p.onConfirm()}>
          {p.confirmLabel}
        </button>
      </div>
    ) : null,
}))
vi.mock('../../lib/api/filePulls', () => ({
  pushState: m.pushState,
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

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null
const onDone = vi.fn(async () => {})

const open = vi.fn()
let tab: { location: { href: string }; close: () => void; opener: unknown }

beforeEach(() => {
  sessionStorage.clear()
  tab = { location: { href: '' }, close: vi.fn(), opener: {} }
  open.mockReturnValue(tab)
  vi.stubGlobal('open', open)
  m.pullFile.mockResolvedValue({})
  m.at.mockResolvedValue('p/files/ben.docx')
  m.url.mockResolvedValue('https://signed/ben')
  m.endPull.mockResolvedValue(undefined)
  m.saveDraft.mockResolvedValue({})
})

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = null
  root = null
  vi.clearAllMocks()
})

function panel(files: GeneralDraftFile[]) {
  return (
      <DraftPanel
        draft={{ id: 'd', base_seq: 6 } as never}
        files={files}
        conflicts={[]}
        repo={repo as never}
        state={state}
        mainOf={() => ''}
        mainStorageOf={() => null}
        path=""
        onNavigate={vi.fn()}
        onRename={vi.fn()}
        onOpen={vi.fn()}
        onDone={onDone}
      />
  )
}

async function show(files: GeneralDraftFile[]) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(panel(files)))
}

const button = (label: string) => [...host!.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!

it('shows a held Word file with the same message as the upload', async () => {
  m.pushState.mockResolvedValue({ base_seq: 4, main_seq: 6, main_author: 'ben', main_at: null, main_removed: false })
  await show([row()])
  expect(m.pushState).toHaveBeenCalledWith('repo', 'Chap1-4.docx')
  expect(host!.textContent).toContain('Ben updated this since you pulled')
  expect(button("Download Ben's version")).toBeTruthy()
})

it('does not check a file Main has never had, or a file that is not Word', async () => {
  await show([row({ action: 'added' }), row({ path: 'Notes.pdf' })])
  expect(m.pushState).not.toHaveBeenCalled()
})

it('shows nothing for a pull Main has not moved past', async () => {
  m.pushState.mockResolvedValue({ base_seq: 6, main_seq: 6, main_author: 'ben', main_at: null, main_removed: false })
  await show([row()])
  expect(host!.textContent).not.toContain('since you pulled')
})

it('replaces a removed file by ending the pull and saving the draft row as added', async () => {
  m.pushState.mockResolvedValue({ base_seq: 4, main_seq: 6, main_author: 'ben', main_at: null, main_removed: true })
  await show([row()])
  expect(host!.textContent).toContain('Ben removed this file since you pulled')
  await act(async () => button('Replace it anyway').click())
  await act(async () => (host!.querySelector('[data-confirm]') as HTMLElement).click())
  expect(m.endPull).toHaveBeenCalledWith('repo', 'Chap1-4.docx')
  expect(m.saveDraft).toHaveBeenCalledWith({
    repoId: 'repo',
    path: 'Chap1-4.docx',
    action: 'added',
    kind: 'binary',
    storagePath: 'p/files/mine.docx',
  })
})

it("keeps the row held after their version is downloaded, until a new copy replaces the draft's", async () => {
  const held = { base_seq: 4, main_seq: 6, main_author: 'ben', main_at: null, main_removed: false }
  m.pushState.mockResolvedValueOnce(held).mockResolvedValue({ ...held, base_seq: 6 })
  await show([row()])
  await act(async () => button("Download Ben's version").click())
  expect(m.pullFile).toHaveBeenCalledWith('repo', 'Chap1-4.docx', true)
  expect(open).toHaveBeenCalledWith('', '_blank')
  expect(tab.location.href).toBe('https://signed/ben')
  // The recheck now says clear, but the draft still holds the old copy.
  expect(m.pushState).toHaveBeenCalledTimes(2)
  expect(host!.textContent).toContain("You have Ben's version now.")
  expect(host!.textContent).toContain('Held')
  await act(async () => root!.render(panel([row({ storage_path: 'p/files/combined.docx' })])))
  expect(host!.textContent).not.toContain("You have Ben's version now.")
  expect(host!.textContent).not.toContain('Held')
})

it('offers a link in the row when the browser blocks the download', async () => {
  open.mockReturnValue(null)
  m.pushState.mockResolvedValue({ base_seq: 4, main_seq: 6, main_author: 'ben', main_at: null, main_removed: false })
  await show([row()])
  await act(async () => button("Download Ben's version").click())
  expect(host!.querySelector('a[href="https://signed/ben"]')).toBeTruthy()
})

it('keeps that hold when the panel opens again, as after leaving the tab', async () => {
  const held = { base_seq: 4, main_seq: 6, main_author: 'ben', main_at: null, main_removed: false }
  m.pushState.mockResolvedValueOnce(held).mockResolvedValue({ ...held, base_seq: 6 })
  await show([row()])
  await act(async () => button("Download Ben's version").click())
  await act(async () => root!.unmount())
  root = createRoot(host!)
  await act(async () => root!.render(panel([row()])))
  expect(host!.textContent).toContain("You have Ben's version now.")
})
