// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LazyDocxPreview } from './LazyDocxPreview'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const m = vi.hoisted(() => ({ reachable: false, url: vi.fn(), blob: vi.fn(), read: vi.fn(), pdf: vi.fn() }))

vi.mock('../../lib/general/officeViewer', async (orig) => ({
  ...(await orig<typeof import('../../lib/general/officeViewer')>()),
  officeViewerReachable: () => m.reachable,
  // happy-dom would load the frame; the viewer's address has its own test.
  officeViewerUrl: () => 'about:blank',
}))
vi.mock('../../lib/api/general', () => ({ projectFileUrl: m.url, projectFileBlob: m.blob }))
vi.mock('../../lib/general/office', () => ({ xlsxToWorkbook: m.read }))
vi.mock('./ExcelEditor', () => ({
  default: (p: { readOnly?: boolean; workbook: { sheets: { name: string }[] } }) => (
    <div data-sheet={p.workbook.sheets[0]?.name} data-readonly={String(Boolean(p.readOnly))} />
  ),
}))
vi.mock('./DocxPreview', () => ({ DocxPreview: () => <div data-docx /> }))
vi.mock('../../lib/api/wordPdf', () => ({ wordPdfUrl: m.pdf }))
vi.mock('./LazyPdfPreview', () => ({ LazyPdfPreview: (p: { url?: string }) => <div data-pdf={p.url} /> }))

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null

beforeEach(() => {
  m.reachable = false
  m.url.mockResolvedValue('https://signed/url')
  m.blob.mockResolvedValue(new Blob([new Uint8Array(4)]))
  m.read.mockResolvedValue({ sheets: [{ name: 'Totals', rows: [] }] })
})

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = null
  root = null
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

async function show(label: string) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<LazyDocxPreview storagePath={`p/files/${label}`} label={label} />))
}

/** Waits out the lazy chunk, then the bytes and the read. */
async function settle(done: () => boolean) {
  for (let i = 0; i < 200 && !done(); i++) await act(async () => new Promise((r) => setTimeout(r, 10)))
}

it('shows a .xlsx read-only in the sheet view, from its bytes, under the simplified line', async () => {
  await show('Budget.xlsx')
  await settle(() => host!.querySelector('[data-sheet]') !== null)
  expect(m.blob).toHaveBeenCalledWith('p/files/Budget.xlsx')
  const file = m.read.mock.calls[0][0] as File
  expect(file.name).toBe('Budget.xlsx')
  expect(host!.textContent).toContain('A simplified view. Download to see it exactly as Excel shows it.')
  const grid = host!.querySelector('[data-sheet]')
  expect(grid?.getAttribute('data-sheet')).toBe('Totals')
  expect(grid?.getAttribute('data-readonly')).toBe('true')
  expect(host!.querySelector('[data-docx]')).toBeNull()
})

it('says so when the file cannot be read', async () => {
  m.read.mockRejectedValue(new Error('bad zip'))
  await show('Budget.xlsm')
  await settle(() => host!.textContent!.includes('Could not read'))
  expect(host!.textContent).toContain('Could not read this file. Download it to open it in Excel.')
})

it("names Excel and Google Sheets in Microsoft's viewer", async () => {
  m.reachable = true
  await show('Budget.xlsx')
  expect(host!.textContent).toContain("Shown by Microsoft's Office viewer, as Excel draws it.")
  expect(host!.textContent).toContain('From Google Sheets, download it as Microsoft Excel (.xlsx) before uploading.')
  expect(host!.textContent).toContain('Use the simple preview')
})

it('offers no simple preview for a .xls', async () => {
  m.reachable = true
  await show('Old.xls')
  expect(host!.textContent).toContain('as Excel draws it')
  expect(host!.textContent).not.toContain('Use the simple preview')
})

it('shows a .docx as the PDF the server made, on any host', async () => {
  m.reachable = true
  m.pdf.mockResolvedValue('https://signed/preview.pdf')
  await show('Chap1.docx')
  await settle(() => host!.querySelector('[data-pdf]') !== null)
  expect(m.pdf).toHaveBeenCalledWith('p/files/Chap1.docx')
  expect(host!.querySelector('[data-pdf]')?.getAttribute('data-pdf')).toBe('https://signed/preview.pdf')
  expect(host!.textContent).toContain('Download gets the original Word file.')
  expect(host!.textContent).not.toContain('as Word draws it')
  expect(host!.querySelector('iframe')).toBeNull()
})

it('says what went wrong, then offers the simple preview and a retry', async () => {
  m.pdf.mockRejectedValueOnce(new Error('The PDF converter is not set up on the server yet.'))
  m.pdf.mockResolvedValueOnce('https://signed/again.pdf')
  await show('Chap1.docx')
  await settle(() => host!.textContent!.includes('not set up'))
  expect(host!.textContent).toContain('Use the simple preview')
  const retry = [...host!.querySelectorAll('button')].find((b) => b.textContent === 'Try again')!
  await act(async () => retry.click())
  await settle(() => host!.querySelector('[data-pdf]') !== null)
  expect(host!.querySelector('[data-pdf]')?.getAttribute('data-pdf')).toBe('https://signed/again.pdf')
})

it('gives a .doc the PDF preview but no simple preview', async () => {
  m.pdf.mockResolvedValue('https://signed/old.pdf')
  await show('Old.doc')
  await settle(() => host!.querySelector('[data-pdf]') !== null)
  expect(host!.textContent).not.toContain('Use the simple preview')
})
