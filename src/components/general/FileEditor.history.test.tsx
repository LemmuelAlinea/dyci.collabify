// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { FileEditor } from './FileEditor'
import type { OpenFile } from './FileEditor'
import type { GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../ui/Modal', () => ({
  Modal: (p: { open: boolean; children: ReactNode }) => (p.open ? <div>{p.children}</div> : null),
}))
vi.mock('../../lib/api/general', () => ({
  commitFiles: vi.fn(),
  discardDraftFile: vi.fn(),
  projectFileUrl: vi.fn(),
  saveDraftFile: vi.fn(),
}))
vi.mock('../../lib/api/workAi', () => ({ summarizeFile: vi.fn(), writeChangeMessage: vi.fn() }))
vi.mock('./CodeEditor', () => ({ default: () => <div data-code-editor /> }))
vi.mock('./WordVersionPanel', () => ({ WordVersionPanel: () => null }))
vi.mock('./FileHistoryPanel', () => ({
  FileHistoryPanel: (p: { path: string; onDone: () => void; onClose: () => void }) => (
    <div data-history={p.path}>
      <button onClick={p.onDone}>Restored</button>
      <button onClick={p.onClose}>Close the history</button>
    </div>
  ),
}))

const repo = { id: 'repo', name: 'Files', file_count: 1, commit_count: 4, last_author: null, last_commit_at: null }
const state = {
  project: null,
  myRole: 'member',
  readOnly: false,
  viewerId: 'me',
  can: () => false,
  nameOf: () => 'Me',
} as unknown as GeneralProjectState

const notes: OpenFile = {
  path: 'notes.md',
  kind: 'text',
  content: 'hi',
  storagePath: null,
  action: 'changed',
  fromDraft: false,
  mainAt: '2026-11-14T00:00:00Z',
}

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null
const onClose = vi.fn()
const onSaved = vi.fn(async () => {})

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = null
  root = null
  vi.clearAllMocks()
})

async function open(file: OpenFile, withHistory = true) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <FileEditor
        file={file}
        repo={repo as never}
        state={state}
        onClose={onClose}
        onSaved={onSaved}
        fileHistory={withHistory ? { draftFiles: [] } : undefined}
      />,
    ),
  )
}

const historyButton = () => [...host!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'History')
const click = async (label: string) =>
  act(async () => [...host!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label)!.click())

it('opens the history of a file Main has, and closes it again', async () => {
  await open(notes)
  expect(host!.querySelector('[data-history]')).toBeNull()
  await click('History')
  expect(host!.querySelector('[data-history="notes.md"]')).not.toBeNull()
  expect(historyButton()!.getAttribute('aria-pressed')).toBe('true')
  await click('Close the history')
  expect(host!.querySelector('[data-history]')).toBeNull()
})

it('offers History on a draft copy of a Main file', async () => {
  await open({ ...notes, fromDraft: true })
  expect(historyButton()).toBeDefined()
})

it('offers no History on a new draft file, a shared copy, or outside the Files tab', async () => {
  await open({ ...notes, fromDraft: true, action: 'added', mainAt: null })
  expect(historyButton()).toBeUndefined()
  await act(async () => root!.unmount())
  host!.remove()
  await open({ ...notes, sharedBy: 'Ana' })
  expect(historyButton()).toBeUndefined()
  await act(async () => root!.unmount())
  host!.remove()
  await open(notes, false)
  expect(historyButton()).toBeUndefined()
})

it('closes the file and reloads after a restore lands', async () => {
  await open(notes)
  await click('History')
  await click('Restored')
  expect(onClose).toHaveBeenCalled()
  expect(onSaved).toHaveBeenCalled()
})
