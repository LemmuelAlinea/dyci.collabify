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
  path: 'Thesis/Chap1-4.docx',
  kind: 'binary',
  content: '',
  storagePath: 'p/files/main.docx',
  action: 'changed',
  fromDraft: false,
  mainAt: '2026-11-14T02:00:00Z',
}

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null
const onClose = vi.fn()
const onSaved = vi.fn(async () => {})
const open = vi.fn()

beforeEach(() => {
  vi.stubGlobal('open', open)
  m.listPulls.mockResolvedValue([])
  m.url.mockResolvedValue('https://signed/url')
  m.upload.mockResolvedValue('p/files/new.docx')
  m.pullFile.mockResolvedValue({})
  m.endPull.mockResolvedValue(undefined)
  m.saveDraft.mockResolvedValue({})
  m.commit.mockResolvedValue({})
  m.discard.mockResolvedValue(undefined)
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

it('pulls from Main and downloads on Edit in Word', async () => {
  await show(mainFile)
  await click('Edit in Word')
  expect(m.pullFile).toHaveBeenCalledWith('repo', 'Thesis/Chap1-4.docx', true)
  expect(m.url).toHaveBeenCalledWith('p/files/main.docx', 'Chap1-4.docx')
  expect(open).toHaveBeenCalledWith('https://signed/url', '_blank', 'noopener')
  expect(m.toast).toHaveBeenCalledWith('Downloaded. Edit it in Word, then upload it here as a new version.')
})

it('pulls from the draft for a draft copy of a Main file', async () => {
  await show({ ...mainFile, fromDraft: true, storagePath: 'p/files/draft.docx' })
  await click('Edit in Word')
  expect(m.pullFile).toHaveBeenCalledWith('repo', 'Thesis/Chap1-4.docx', false)
})

it('only downloads a file Main has never had', async () => {
  await show({ ...mainFile, fromDraft: true, action: 'added', mainAt: null })
  await click('Edit in Word')
  expect(m.pullFile).not.toHaveBeenCalled()
  expect(open).toHaveBeenCalled()
})

it('hides every write control from read-only viewers, stakeholders and teachers', async () => {
  for (const state of [member({ readOnly: true }), member({ myRole: 'stakeholder' } as never), member({ classTeacher: true })]) {
    await show(mainFile, state)
    expect(buttons()).not.toContain('Edit in Word')
    expect(buttons()).not.toContain('Upload a new version')
    await act(async () => root!.unmount())
    host!.remove()
    root = null
  }
})

it('offers no Edit in Word for a PDF but does offer a new version', async () => {
  await show({ ...mainFile, path: 'Forms/Consent.pdf' })
  expect(buttons()).not.toContain('Edit in Word')
  expect(buttons()).toContain('Upload a new version')
})

it("shows who else pulled it, and lets you end your own pull", async () => {
  const now = Date.now()
  m.listPulls.mockResolvedValue([
    { repo_id: 'repo', path: 'Thesis/Chap1-4.docx', user_id: 'ana', base_seq: 4, pulled_at: new Date(now - 2 * 3600_000).toISOString() },
    { repo_id: 'repo', path: 'Thesis/Chap1-4.docx', user_id: 'me', base_seq: 4, pulled_at: new Date(now - 5 * 60_000).toISOString() },
    { repo_id: 'repo', path: 'Other.docx', user_id: 'ben', base_seq: 4, pulled_at: new Date(now).toISOString() },
  ])
  await show(mainFile)
  expect(host!.textContent).toContain('Ana pulled this 2 hours ago')
  expect(host!.textContent).toContain('You pulled this 5 minutes ago')
  expect(host!.textContent).not.toContain('Ben')
  await click("I'm done editing")
  expect(m.endPull).toHaveBeenCalledWith('repo', 'Thesis/Chap1-4.docx')
})

it('refuses a file of another type before uploading anything', async () => {
  await show(mainFile)
  await pick('Chap1-4.pdf')
  expect(host!.textContent).toContain('Pick a .docx file. This one replaces Chap1-4.docx, so it has to be the same type.')
  expect(m.upload).not.toHaveBeenCalled()
})

it('uploads a clear push and saves it to the draft as a change', async () => {
  m.pushState.mockResolvedValue({ base_seq: 4, main_seq: 4, main_author: 'ana', main_at: null, main_removed: false })
  await show(mainFile)
  await pick('Chap1-4.docx')
  expect(m.upload).toHaveBeenCalledWith('p', expect.any(File))
  await click('Save to my draft')
  expect(m.saveDraft).toHaveBeenCalledWith({
    repoId: 'repo',
    path: 'Thesis/Chap1-4.docx',
    action: 'changed',
    kind: 'binary',
    storagePath: 'p/files/new.docx',
  })
  expect(onClose).toHaveBeenCalled()
  expect(onSaved).toHaveBeenCalled()
})

it('holds a push from an old copy, then replaces it only after ending the pull', async () => {
  m.pushState.mockResolvedValue({ base_seq: 4, main_seq: 6, main_author: 'ben', main_at: '2026-11-15T07:10:00Z', main_removed: false })
  await show(mainFile)
  await pick('Chap1-4.docx')
  expect(host!.textContent).toContain('Ben updated this since you pulled')
  expect(m.upload).not.toHaveBeenCalled()
  await click('Replace it anyway')
  await act(async () => (host!.querySelector('[data-confirm]') as HTMLElement).click())
  expect(m.endPull).toHaveBeenCalledWith('repo', 'Thesis/Chap1-4.docx')
  expect(m.pullFile).not.toHaveBeenCalled()
  expect(m.upload).toHaveBeenCalled()
  await click('Save to my draft')
  expect(m.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ action: 'changed' }))
})

it('puts a removed file back as an added one', async () => {
  m.pushState.mockResolvedValue({ base_seq: 4, main_seq: 6, main_author: 'ben', main_at: null, main_removed: true })
  await show(mainFile)
  await pick('Chap1-4.docx')
  expect(host!.textContent).toContain('Ben removed this file since you pulled')
  await click('Replace it anyway')
  await act(async () => (host!.querySelector('[data-confirm]') as HTMLElement).click())
  await click('Save to my draft')
  expect(m.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ action: 'added' }))
})

it("gets the newer version as a new pull from Main", async () => {
  m.pushState.mockResolvedValue({ base_seq: 4, main_seq: 6, main_author: 'ben', main_at: null, main_removed: false })
  m.at.mockResolvedValue('p/files/ben.docx')
  await show(mainFile)
  await pick('Chap1-4.docx')
  await click("Download Ben's version")
  expect(m.pullFile).toHaveBeenCalledWith('repo', 'Thesis/Chap1-4.docx', true)
  expect(m.at).toHaveBeenCalledWith('repo', 'Thesis/Chap1-4.docx', 6)
  expect(m.url).toHaveBeenCalledWith('p/files/ben.docx', 'Chap1-4.docx')
  expect(m.upload).not.toHaveBeenCalled()
})

it("warns when there is no pull on record, and continues on request", async () => {
  m.pushState.mockResolvedValue(null)
  await show(mainFile)
  await pick('Chap1-4.docx')
  expect(host!.textContent).toContain("Collabify doesn't know which copy you started from.")
  expect(host!.textContent).toContain("someone's changes may be lost.")
  expect(m.upload).not.toHaveBeenCalled()
  await click('Continue')
  expect(m.upload).toHaveBeenCalled()
})

it('commits to Main and explains a stale push in plain words', async () => {
  m.pushState.mockResolvedValue({ base_seq: 4, main_seq: 4, main_author: null, main_at: null, main_removed: false })
  m.commit.mockRejectedValue({
    message:
      'Main has a newer version of Thesis/Chap1-4.docx than the copy this was made from. Get the newer version, combine the two in Word, then upload again.',
  })
  await show(mainFile, member({}, true))
  await pick('Chap1-4.docx')
  const input = host!.querySelector('input[placeholder]:not([type="file"])') as HTMLInputElement
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    set.call(input, 'Combined the adviser notes')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('Commit to Main')
  expect(m.commit).toHaveBeenCalledWith({
    repoId: 'repo',
    message: 'Combined the adviser notes',
    baseSeq: 4,
    files: [{ path: 'Thesis/Chap1-4.docx', action: 'changed', kind: 'binary', content: '', storage_path: 'p/files/new.docx' }],
  })
  expect(host!.textContent).toContain(
    'Main has a newer version of Thesis/Chap1-4.docx than the copy you started from. You have to get the newer version, combine the two in Word and upload again.',
  )
})
