// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WordVersionPanel } from './WordVersionPanel'
import type { OpenFile } from './FileEditor'
import type { GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const m = vi.hoisted(() => ({
  toast: vi.fn(),
  pullFile: vi.fn(),
  endPull: vi.fn(),
  listPulls: vi.fn(),
  pushState: vi.fn(),
  baseOf: vi.fn(),
  recordBase: vi.fn(),
  mainSeq: vi.fn(),
  upload: vi.fn(),
  saveDraft: vi.fn(),
  commit: vi.fn(),
  discard: vi.fn(),
  url: vi.fn(),
  at: vi.fn(),
  describe: vi.fn(),
}))

vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: m.toast }) }))
vi.mock('./WordDiff', () => ({ WordDiff: () => null }))
vi.mock('../ui/ConfirmDialog', () => ({
  ConfirmDialog: (p: { open: boolean; title: string; body: ReactNode; confirmLabel: string; onConfirm: () => Promise<void> }) =>
    p.open ? (
      <div data-dialog>
        <h2>{p.title}</h2>
        <button type="button" data-confirm onClick={() => void p.onConfirm()}>
          {p.confirmLabel}
        </button>
      </div>
    ) : null,
}))
vi.mock('../../lib/api/filePulls', () => ({
  pullFile: m.pullFile,
  endPull: m.endPull,
  listPulls: m.listPulls,
  pushState: m.pushState,
  baseOf: m.baseOf,
  recordBase: m.recordBase,
  mainSeq: m.mainSeq,
}))
vi.mock('../../lib/api/general', () => ({
  uploadProjectFile: m.upload,
  saveDraftFile: m.saveDraft,
  commitFiles: m.commit,
  discardDraftFile: m.discard,
  projectFileUrl: m.url,
  storagePathAt: m.at,
}))
vi.mock('../../lib/api/workAi', () => ({ writeChangeMessage: m.describe }))

const repo = { id: 'repo', name: 'Files', file_count: 1, commit_count: 4, last_author: null, last_commit_at: null }
const names: Record<string, string> = { ana: 'Ana', ben: 'Ben', me: 'Me' }

function member(over: Partial<GeneralProjectState> = {}, commit = false) {
  return {
    project: { id: 'p', class_board_id: null },
    myRole: 'member',
    readOnly: false,
    viewerId: 'me',
    can: (p: string) => commit && p === 'commit_main',
    nameOf: (id: string) => names[id] ?? 'A former member',
    ...over,
  } as unknown as GeneralProjectState
}

const mainFile: OpenFile = {
  path: 'Budget/Budget.xlsx',
  kind: 'binary',
  content: '',
  storagePath: 'p/files/main.xlsx',
  action: 'changed',
  fromDraft: false,
  mainAt: '2026-11-14T02:00:00Z',
}

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null
const onClose = vi.fn()
const onSaved = vi.fn(async () => {})
const open = vi.fn()
let tab: { location: { href: string }; close: ReturnType<typeof vi.fn>; opener: unknown }

beforeEach(() => {
  tab = { location: { href: '' }, close: vi.fn(), opener: {} }
  open.mockReturnValue(tab)
  vi.stubGlobal('open', open)
  m.listPulls.mockResolvedValue([])
  m.url.mockResolvedValue('https://signed/url')
  m.upload.mockResolvedValue('p/files/new.xlsx')
  m.pullFile.mockResolvedValue({})
  m.endPull.mockResolvedValue(undefined)
  m.saveDraft.mockResolvedValue({})
  m.commit.mockResolvedValue({})
  m.discard.mockResolvedValue(undefined)
  m.recordBase.mockResolvedValue(undefined)
  m.baseOf.mockResolvedValue(null)
  m.mainSeq.mockResolvedValue(5)
})

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = null
  root = null
  vi.clearAllMocks()
})

async function show(file: OpenFile, state = member()) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(<WordVersionPanel file={file} repo={repo as never} state={state} onClose={onClose} onSaved={onSaved} />),
  )
}

const buttons = () => [...host!.querySelectorAll('button')].map((b) => b.textContent?.trim())
const button = (label: string) => {
  const hit = [...host!.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
  if (!hit) throw new Error(`No button ${label}: ${buttons().join(' | ')}`)
  return hit
}
const click = (label: string) => act(async () => button(label).click())

async function pick(name: string) {
  const input = host!.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File([new Uint8Array(4)], name)
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

it('names Excel on the button, the note and the download toast', async () => {
  await show(mainFile)
  expect(host!.textContent).toContain('Edit it in Excel, then upload it here as a new version.')
  expect(buttons()).not.toContain('Edit in Word')
  await click('Edit in Excel')
  expect(m.pullFile).toHaveBeenCalledWith('repo', 'Budget/Budget.xlsx', true)
  expect(m.url).toHaveBeenCalledWith('p/files/main.xlsx', 'Budget.xlsx')
  expect(m.toast).toHaveBeenCalledWith('Downloaded. Edit it in Excel, then upload it here as a new version.')
})

it('offers Edit in Excel for a .xlsm and a .xls too', async () => {
  await show({ ...mainFile, path: 'Budget/Macros.xlsm', storagePath: 'p/files/m.xlsm' })
  expect(buttons()).toContain('Edit in Excel')
  await act(async () => root!.unmount())
  host!.remove()
  await show({ ...mainFile, path: 'Budget/Old.xls', storagePath: 'p/files/o.xls' })
  expect(buttons()).toContain('Edit in Excel')
})

it('holds a push of an .xlsx from an old copy and says to combine the two in Excel', async () => {
  m.pushState.mockResolvedValue({ base_seq: 4, main_seq: 6, main_author: 'ben', main_at: '2026-11-15T07:10:00Z', main_removed: false })
  await show(mainFile)
  await pick('Budget.xlsx')
  expect(host!.textContent).toContain('Ben updated this since you pulled')
  expect(host!.textContent).toContain('combine the two in Excel, then upload the result here.')
  expect(host!.textContent).not.toContain('Word')
  expect(m.upload).not.toHaveBeenCalled()
  await click('Replace it anyway')
  await act(async () => (host!.querySelector('[data-confirm]') as HTMLElement).click())
  expect(m.recordBase).toHaveBeenCalledWith('repo', 'Budget/Budget.xlsx', 'p/files/new.xlsx', 6)
})

it('records the base of a clear .xlsx upload', async () => {
  m.pushState.mockResolvedValue({ base_seq: 4, main_seq: 4, main_author: 'me', main_at: null, main_removed: false })
  await show(mainFile)
  await pick('Budget.xlsx')
  expect(m.recordBase).toHaveBeenCalledWith('repo', 'Budget/Budget.xlsx', 'p/files/new.xlsx', 4)
})

it("gets the newer version and says to combine the two in Excel", async () => {
  m.pushState.mockResolvedValue({ base_seq: 4, main_seq: 6, main_author: 'ben', main_at: null, main_removed: false })
  m.at.mockResolvedValue('p/files/ben.xlsx')
  await show(mainFile)
  await pick('Budget.xlsx')
  await click("Download Ben's version")
  expect(m.at).toHaveBeenCalledWith('repo', 'Budget/Budget.xlsx', 6)
  expect(m.toast).toHaveBeenCalledWith('Downloaded the newer version. Combine the two in Excel, then upload the result here.')
})
