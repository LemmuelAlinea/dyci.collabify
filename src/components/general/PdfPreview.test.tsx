// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
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
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({ promise: Promise.resolve({ numPages: 3, getPage: m.getPage, destroy: vi.fn() }), destroy: vi.fn() }),
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
})

it('leaves offscreen PDF pages unrendered', async () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root?.render(<PdfPreview storagePath="word.pdf" label="Word PDF" />))
  expect(host.querySelectorAll('canvas')).toHaveLength(3)
  expect(m.getPage).not.toHaveBeenCalledWith(2)
})
