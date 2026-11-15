// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { Workbook } from '../../lib/general/sheet'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const m = vi.hoisted(() => ({ blob: vi.fn(), read: vi.fn() }))
vi.mock('../../lib/api/general', () => ({ projectFileBlob: m.blob }))
vi.mock('../../lib/general/office', () => ({ xlsxToWorkbook: m.read }))

import { ExcelDiff } from './ExcelDiff'

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = null
  root = null
  vi.clearAllMocks()
})

async function show(el: React.ReactElement) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
}

const book = (rows: string[][]): Workbook => ({ sheets: [{ name: 'S', rows }] })

it('shows the first 200 changes and says how many more', async () => {
  m.blob.mockResolvedValue(new Blob(['x']))
  m.read.mockResolvedValue(book(Array.from({ length: 250 }, () => ['new'])))
  await show(<ExcelDiff before={book(Array.from({ length: 250 }, () => ['old']))} after="p/files/b.xlsx" caption="Cap" />)
  expect(host!.querySelectorAll('li').length).toBe(200)
  expect(host!.textContent).toContain('and 50 more')
})

it('says when a version could not be read', async () => {
  m.blob.mockRejectedValue(new Error('gone'))
  await show(<ExcelDiff before="p/files/a.xlsx" after="p/files/b.xlsx" caption="Cap" />)
  expect(host!.textContent).toContain('Could not read one of the versions. Download them to compare in Excel.')
})

it('compares a converted sheet given as a workbook with no download', async () => {
  m.blob.mockResolvedValue(new Blob(['x']))
  m.read.mockResolvedValue(book([['a', 'new']]))
  await show(<ExcelDiff before={book([['a', 'old']])} after="p/files/b.xlsx" caption="Cap" />)
  expect(host!.textContent).not.toContain('Sheet added')
  expect(host!.textContent).toContain('B1')
  expect(m.blob).toHaveBeenCalledTimes(1)
})
