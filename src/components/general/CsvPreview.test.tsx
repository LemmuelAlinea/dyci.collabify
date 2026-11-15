// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { CsvPreview } from './CsvPreview'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const m = vi.hoisted(() => ({ upload: vi.fn(), convert: vi.fn(), reachable: true }))
vi.mock('../../lib/api/general', () => ({ uploadProjectFile: m.upload }))
vi.mock('../../lib/general/office', () => ({ workbookToXlsx: m.convert }))
vi.mock('../../lib/general/officeViewer', () => ({ officeViewerReachable: () => m.reachable }))
vi.mock('./ExcelEditor', () => ({ default: () => <div data-sheet /> }))
vi.mock('./OfficeViewer', () => ({ OfficeViewer: (p: { storagePath: string; label: string }) => <div data-office={p.storagePath} data-label={p.label} /> }))

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = null
  root = null
  m.upload.mockReset()
  m.convert.mockReset()
  m.reachable = true
})

async function show() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(
    <CsvPreview projectId="project" label="Report.csv" workbook={{ sheets: [{ name: 'Report', rows: [['a', 'b']] }] }} fill={false} />,
  ))
}

it('converts CSV workbook data to XLSX and previews it with Microsoft Excel', async () => {
  m.convert.mockResolvedValue(new Blob(['xlsx'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  m.upload.mockResolvedValue('project/files/preview.xlsx')
  await show()
  expect(m.convert).toHaveBeenCalledOnce()
  expect(m.convert.mock.calls[0][1]).toEqual({ preserveText: true })
  expect(m.upload).toHaveBeenCalledOnce()
  expect(m.upload.mock.calls[0][0]).toBe('project')
  expect((m.upload.mock.calls[0][1] as File).name).toBe('Report.xlsx')
  expect(host!.querySelector('[data-office="project/files/preview.xlsx"]')?.getAttribute('data-label')).toBe('Report.xlsx')
  expect(host!.querySelector('[data-sheet]')).toBeNull()
})

it('keeps CSV readable when upload fails', async () => {
  m.convert.mockResolvedValue(new Blob(['xlsx']))
  m.upload.mockRejectedValue(new Error('upload refused'))
  await show()
  expect(host!.textContent).toContain('upload refused')
  expect(host!.querySelector('[data-sheet]')).not.toBeNull()
})
