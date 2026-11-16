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

const pdf = vi.hoisted(() => ({ upload: vi.fn(), commit: vi.fn() }))

vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../ui/Modal', () => ({
  Modal: (p: { open: boolean; children: ReactNode }) => (p.open ? <div>{p.children}</div> : null),
}))
vi.mock('../../lib/api/general', () => ({
  commitFiles: pdf.commit,
  discardDraftFile: vi.fn(),
  projectFileUrl: vi.fn(),
  saveDraftFile: vi.fn(),
  uploadProjectFile: pdf.upload,
}))
vi.mock('../../lib/api/workAi', () => ({ summarizeFile: vi.fn(), writeChangeMessage: vi.fn() }))
vi.mock('./ExcelEditor', () => ({ default: () => <div data-sheet-editor /> }))
vi.mock('./CodeEditor', () => ({ default: () => <div data-code-editor /> }))
vi.mock('./word/WordEditor', () => ({ default: () => <div data-word-editor /> }))
vi.mock('./LazyPdfPreview', () => ({ LazyPdfPreview: (p: { storagePath: string }) => <div data-pdf-preview={p.storagePath} /> }))
vi.mock('./LazyDocxPreview', () => ({ LazyDocxPreview: (p: { label: string }) => <div data-office-preview={p.label} /> }))
vi.mock('./CsvPreview', () => ({ CsvPreview: (p: { onEdit?: () => void }) => <button data-csv-preview onClick={p.onEdit}>Edit CSV</button> }))
vi.mock('./WordVersionPanel', () => ({ WordVersionPanel: () => null }))

const repo = { id: 'repo', name: 'Files', file_count: 1, commit_count: 4, last_author: null, last_commit_at: null }
const state = {
  project: { id: 'p', class_board_id: null },
  myRole: 'member',
  readOnly: false,
  viewerId: 'me',
  can: () => false,
  nameOf: () => 'Me',
} as unknown as GeneralProjectState

const NOTE =
  'This copy was converted when it was uploaded, so charts, pictures and some formatting may be gone. Upload the original .xlsx again with New, Upload a file, under the same name, to keep it exactly.'

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = null
  root = null
  pdf.upload.mockReset()
  pdf.commit.mockReset()
})

async function open(file: OpenFile) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(<FileEditor file={file} repo={repo as never} state={state} onClose={() => {}} onSaved={async () => {}} />),
  )
}

const sheet = (path: string): OpenFile => ({
  path,
  kind: 'sheet',
  content: JSON.stringify({ sheets: [{ name: 'Sheet1', rows: [['1']] }] }),
  storagePath: null,
  action: 'changed',
  fromDraft: false,
})

it('notes that an old converted .xlsx sheet lost what conversion drops', async () => {
  await open(sheet('Budget.xlsx'))
  expect(host!.textContent).toContain(NOTE)
  expect(host!.querySelector('[data-sheet-editor]')).not.toBeNull()
})

it('opens a .csv sheet in preview, then lets its owner edit it', async () => {
  await open(sheet('data.csv'))
  expect(host!.textContent).not.toContain('converted when it was uploaded')
  expect(host!.querySelector('[data-csv-preview]')).not.toBeNull()
  expect(host!.querySelector('[data-sheet-editor]')).toBeNull()
  await act(async () => host!.querySelector<HTMLButtonElement>('[data-csv-preview]')!.click())
  expect(host!.querySelector('[data-sheet-editor]')).not.toBeNull()
  expect(host!.textContent).toContain('View in Microsoft Excel')
})

it('previews an .xlsx kept as uploaded instead of the generic note', async () => {
  await open({ path: 'Budget.xlsx', kind: 'binary', content: '', storagePath: 'p/files/b.xlsx', action: 'changed', fromDraft: false })
  expect(host!.querySelector('[data-office-preview="Budget.xlsx"]')).not.toBeNull()
  expect(host!.textContent).not.toContain('opened elsewhere')
  expect(host!.querySelector('[data-sheet-editor]')).toBeNull()
})

it('shows a current Word PDF companion instead of the Office iframe', async () => {
  await open({ path: 'Thesis.docx', kind: 'binary', content: '', storagePath: 'p/files/word', action: 'changed', fromDraft: false, pdfStoragePath: 'p/files/pdf' })
  expect(host!.querySelector('[data-pdf-preview="p/files/pdf"]')).not.toBeNull()
  expect(host!.querySelector('[data-office-preview]')).toBeNull()
})

it('commits an uploaded PDF as the Word file companion', async () => {
  pdf.upload.mockResolvedValue('p/files/new-pdf')
  pdf.commit.mockResolvedValue({})
  const writer = { ...state, can: (permission: string) => permission === 'commit_main' } as unknown as GeneralProjectState
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<FileEditor file={{ path: 'Thesis.docx', kind: 'binary', content: '', storagePath: 'p/files/word', action: 'changed', fromDraft: false }} repo={repo as never} state={writer} onClose={() => {}} onSaved={async () => {}} />))
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Choose Word PDF preview"]')!
  Object.defineProperty(input, 'files', { value: [new File(['%PDF-1.7'], 'Thesis.pdf', { type: 'application/pdf' })] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  expect(pdf.commit).toHaveBeenCalledWith(expect.objectContaining({
    baseSeq: 4,
    files: [expect.objectContaining({ path: 'Thesis.docx.pdf', kind: 'binary', storage_path: 'p/files/new-pdf' })],
  }))
  expect(host.querySelector('[data-pdf-preview="p/files/new-pdf"]')).not.toBeNull()
})

it('hides the conversion note from a read-only viewer', async () => {
  const readOnlyState = { ...state, readOnly: true } as unknown as GeneralProjectState
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <FileEditor file={sheet('Budget.xlsx')} repo={repo as never} state={readOnlyState} onClose={() => {}} onSaved={async () => {}} />,
    ),
  )
  expect(host.textContent).not.toContain('converted when it was uploaded')
})
