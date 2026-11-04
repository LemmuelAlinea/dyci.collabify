// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { zipSync } from 'fflate'
import { Document, Packer, Paragraph } from 'docx'
import ExcelJS from 'exceljs'
import { afterEach, expect, it, vi } from 'vitest'
import { TaskAttachmentCard } from './TaskAttachmentCard'
import { generalFileUrl } from '../../lib/api/general'
import type { GeneralFile } from '../../lib/general/types'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../lib/api/general', () => ({ generalFileUrl: vi.fn().mockResolvedValue('https://example.test/file') }))
const originalFetch = globalThis.fetch
const originalObserver = globalThis.IntersectionObserver

const file = (name: string): GeneralFile => ({
  id: name, task_id: 'task', project_id: 'project', uploaded_by: 'user',
  file_path: name, file_name: name, mime_type: null, size_bytes: 100,
  created_at: '2026-11-05T03:00:00Z', archived_at: null, archived_by: null,
})

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
async function render(name: string, canTrash = false) {
  vi.stubGlobal('IntersectionObserver', undefined)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<TaskAttachmentCard file={file(name)} canTrash={canTrash} onTrash={vi.fn()} onError={vi.fn()} />))
}
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.stubGlobal('fetch', originalFetch); vi.stubGlobal('IntersectionObserver', originalObserver); vi.mocked(generalFileUrl).mockClear(); vi.restoreAllMocks() })

it('shows actual text in an attachment card', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['Project notes\nFinish the draft']) }))
  await render('notes.txt')
  await vi.waitFor(() => expect(host.querySelector('pre')?.textContent).toContain('Finish the draft'))
  expect(host.querySelector('button[aria-label="Open notes.txt"]')).not.toBeNull()
})

it('shows the contents of an archive in its card', async () => {
  const zip = zipSync({ 'report.txt': new TextEncoder().encode('Hello'), 'images/chart.png': new Uint8Array([1]) })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob([new Uint8Array(zip)]) }))
  await render('assets.zip')
  await vi.waitFor(() => expect(host.querySelector('pre')?.textContent).toContain('images/chart.png'))
  expect(host.querySelector('pre')?.textContent).toContain('report.txt')
})

it('shows Word document text in its card', async () => {
  const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('Draft project scope')] }] }))
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob([new Uint8Array(bytes)]) }))
  await render('scope.docx')
  await vi.waitFor(() => expect(host.querySelector('pre')?.textContent).toContain('Draft project scope'), { timeout: 5000 })
})

it('shows spreadsheet cells in its card', async () => {
  const book = new ExcelJS.Workbook()
  book.addWorksheet('Budget').addRow(['Item', 'Cost'])
  const bytes = await book.xlsx.writeBuffer()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob([new Uint8Array(bytes)]) }))
  await render('budget.xlsx')
  await vi.waitFor(() => expect(host.querySelector('pre')?.textContent).toContain('Item  |  Cost'), { timeout: 5000 })
})

it.each([
  ['report.docx', '#3B82F6'], ['report.pdf', '#EF4444'], ['budget.xlsx', '#22C55E'],
  ['slides.pptx', '#F97316'], ['photo.png', '#A855F7'], ['clip.mp4', '#F43F5E'],
  ['voice.mp3', '#06B6D4'], ['bundle.zip', '#D97706'], ['app.ts', '#38BDF8'],
  ['data.sqlite', '#14B8A6'], ['setup.exe', '#64748B'], ['unknown.bin', '#6B7280'],
])('colors %s attachment previews with %s', async (name, color) => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Preview unavailable')))
  await render(name)
  const previewBox = host.querySelector<HTMLDivElement>(`button[aria-label="Open ${name}"] > div`)
  expect(previewBox?.getAttribute('style')?.toLowerCase()).toContain(color.toLowerCase())
})

it('downloads the file above Move to trash in the action menu', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Preview unavailable')))
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  await render('scope.docx', true)
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Actions for scope.docx"]')!.click())
  const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
  expect(items.map((item) => item.textContent?.trim())).toEqual(['Download', 'Move to trash'])
  await act(async () => items[0].click())
  await vi.waitFor(() => expect(generalFileUrl).toHaveBeenCalledWith('scope.docx', 'scope.docx'))
  const downloaded = click.mock.instances[0] as HTMLAnchorElement
  expect(downloaded.download).toBe('scope.docx')
  expect(downloaded.href).toBe('https://example.test/file')
})
