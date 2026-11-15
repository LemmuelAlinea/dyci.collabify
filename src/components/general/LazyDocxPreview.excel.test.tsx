// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LazyDocxPreview } from './LazyDocxPreview'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const m = vi.hoisted(() => ({ reachable: false, url: vi.fn(), blob: vi.fn(), read: vi.fn() }))

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

it('keeps the Word copy for a .docx', async () => {
  m.reachable = true
  await show('Chap1.docx')
  expect(host!.textContent).toContain('as Word draws it')
  expect(host!.textContent).toContain('From Google Docs')
})

it('opens a .docx in the simple preview by default on Mac', async () => {
  m.reachable = true
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Chrome/131.0')
  await show('Chap1.docx')
  await settle(() => host!.querySelector('[data-docx]') !== null)
  expect(host!.querySelector('[data-docx]')).not.toBeNull()
  expect(host!.textContent).toContain('Show it as Word draws it')
  expect(m.url).not.toHaveBeenCalled()
})
