// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PdfPreview } from './PdfPreview'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.stubGlobal('IntersectionObserver', class {
  observe() {}
  disconnect() {}
})

const m = vi.hoisted(() => ({
  getPage: vi.fn(async () => ({
    getViewport: () => ({ width: 810, height: 1050 }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
  })),
  getDocument: vi.fn(),
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  PDFDataRangeTransport: class {
    length: number
    constructor(length: number) {
      this.length = length
    }
    onDataRange() {}
  },
  getDocument: m.getDocument,
}))
vi.mock('../../lib/api/general', () => ({ projectFileBlob: async () => new Blob(['%PDF-1.7']) }))

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  host?.remove()
  root = null
  host = null
  m.getPage.mockClear()
  m.getDocument.mockClear()
  vi.unstubAllGlobals()
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    disconnect() {}
  })
})

beforeEach(() => {
  m.getDocument.mockImplementation(() => ({
    promise: Promise.resolve({ numPages: 3, getPage: m.getPage, destroy: vi.fn() }),
    destroy: vi.fn(),
  }))
})

async function render(ui: React.ReactElement) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root?.render(ui))
}

it('leaves offscreen PDF pages unrendered', async () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root?.render(<PdfPreview storagePath="word.pdf" label="Word PDF" />))
  expect(host.querySelectorAll('canvas')).toHaveLength(3)
  expect(m.getPage).not.toHaveBeenCalledWith(2)
})

it('reads a signed link in pieces when its size is known, without downloading it first', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  await render(<PdfPreview url="https://signed/thesis.pdf" size={3_600_000} label="Thesis" />)
  const options = m.getDocument.mock.calls[0][0] as { range?: { length: number }; data?: unknown; disableAutoFetch?: boolean }
  expect(options.range?.length).toBe(3_600_000)
  expect(options.data).toBeUndefined()
  expect(options.disableAutoFetch).toBe(true)
  expect(fetchMock).not.toHaveBeenCalled()
})

it('downloads a signed link whole when its size is unknown', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([37, 80, 68, 70])))
  vi.stubGlobal('fetch', fetchMock)
  await render(<PdfPreview url="https://signed/old.pdf" size={null} label="Old" />)
  await act(async () => new Promise((r) => setTimeout(r, 0)))
  expect(fetchMock).toHaveBeenCalledWith('https://signed/old.pdf')
  const options = m.getDocument.mock.calls[0][0] as { range?: unknown; data?: Uint8Array }
  expect(options.range).toBeUndefined()
  expect(options.data).toBeInstanceOf(Uint8Array)
})
